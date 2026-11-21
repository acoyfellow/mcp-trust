import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Urls {
  readonly acmeUrl: string;
  readonly impostorUrl: string;
  readonly gatewayUrl: string;
  readonly agentUrl: string;
}

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const devDir = `${repoRoot}/.dev`;

const PORTS = { acme: 8801, impostor: 8802, agent: 8803 } as const;

const capture = async (cmd: string[]) => {
  const proc = Bun.spawn(cmd, { cwd: repoRoot, env: process.env, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return out + err;
};

export interface Namespaces {
  readonly scratch: string;
  readonly decoy: string;
}

export const findNamespaces = async (): Promise<Namespaces> => {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error(
      "Set CLOUDFLARE_ACCOUNT_ID to the account that holds mcp-trust-scratch and mcp-trust-decoy.",
    );
  }
  const listed = await capture(["bunx", "wrangler", "kv", "namespace", "list"]);
  const entries = JSON.parse(
    listed.slice(listed.indexOf("["), listed.lastIndexOf("]") + 1),
  ) as Array<{
    id: string;
    title: string;
  }>;
  const scratch = entries.find((e) => e.title === "mcp-trust-scratch")?.id;
  const decoy = entries.find((e) => e.title === "mcp-trust-decoy")?.id;
  if (!scratch || !decoy) {
    throw new Error(
      "mcp-trust-scratch and mcp-trust-decoy must both exist in CLOUDFLARE_ACCOUNT_ID. Refusing to run.",
    );
  }
  return { scratch, decoy };
};

const writeConfigs = (ns: Namespaces) => {
  mkdirSync(devDir, { recursive: true });
  const base = { compatibility_date: "2026-09-22", compatibility_flags: ["nodejs_compat"] };
  const kv = (binding: string, id: string) => ({ binding, id, remote: true });
  const configs = {
    acme: {
      ...base,
      name: "mcp-trust-dev-acme",
      main: "../dev/acme.ts",
      kv_namespaces: [kv("SCRATCH", ns.scratch), kv("DECOY", ns.decoy)],
    },
    impostor: {
      ...base,
      name: "mcp-trust-dev-impostor",
      main: "../dev/impostor.ts",
      kv_namespaces: [kv("DECOY", ns.decoy)],
    },
    agent: {
      ...base,
      name: "mcp-trust-dev-agent",
      main: "../dev/agent.ts",
      ai: { binding: "AI", remote: true },
    },
  };
  for (const [name, config] of Object.entries(configs)) {
    writeFileSync(`${devDir}/${name}.jsonc`, JSON.stringify(config, null, 2));
  }
};

const killRepoWorkerd = async () => {
  const listed = await capture(["pgrep", "-f", `${repoRoot}/node_modules/@cloudflare/workerd`]);
  for (const pid of listed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+$/.test(l))) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {}
  }
};

const waitFor = async (what: string, ready: () => Promise<boolean>, ms = 120_000) => {
  const started = Date.now();
  while (!(await ready().catch(() => false))) {
    if (Date.now() - started > ms) throw new Error(`${what} did not become ready; see .dev/*.log`);
    await Bun.sleep(500);
  }
};

export const withStack = async <T>(fn: (urls: Urls) => Promise<T>): Promise<T> => {
  const ns = await findNamespaces();
  if (process.env.MCP_TRUST_URLS) return fn(JSON.parse(process.env.MCP_TRUST_URLS) as Urls);
  writeConfigs(ns);
  const procs: Array<ReturnType<typeof Bun.spawn>> = [];
  const launch = (name: string, cmd: string[]) => {
    const log = openSync(`${devDir}/${name}.log`, "w");
    const proc = Bun.spawn(cmd, { cwd: repoRoot, env: process.env, stdout: log, stderr: log });
    procs.push(proc);
    return proc;
  };
  try {
    for (const name of ["acme", "impostor", "agent"] as const) {
      launch(name, [
        "bunx",
        "wrangler",
        "dev",
        "-c",
        `.dev/${name}.jsonc`,
        "--port",
        String(PORTS[name]),
        "--inspector-port",
        String(PORTS[name] + 500),
        "--ip",
        "127.0.0.1",
      ]);
    }
    launch("gateway", [
      "bunx",
      "alchemy",
      "dev",
      "--no-input",
      "--stage",
      "mcp_trust_run",
      "-c",
      "alchemy.dev.ts",
    ]);
    for (const name of ["acme", "impostor", "agent"] as const) {
      await waitFor(name, async () => (await fetch(`http://127.0.0.1:${PORTS[name]}/`)).status > 0);
    }
    let gatewayUrl = "";
    await waitFor("gateway", async () => {
      const log = await Bun.file(`${devDir}/gateway.log`).text();
      const m = log.match(/gatewayUrl: '([^']+)'/);
      if (m && /Done:/.test(log)) gatewayUrl = m[1] as string;
      return gatewayUrl !== "";
    });
    return await fn({
      acmeUrl: `http://127.0.0.1:${PORTS.acme}`,
      impostorUrl: `http://127.0.0.1:${PORTS.impostor}`,
      agentUrl: `http://127.0.0.1:${PORTS.agent}`,
      gatewayUrl,
    });
  } finally {
    for (const proc of procs) proc.kill("SIGTERM");
    await Promise.race([Promise.all(procs.map((p) => p.exited)), Bun.sleep(10_000)]);
    for (const proc of procs) proc.kill("SIGKILL");
    await killRepoWorkerd();
  }
};
