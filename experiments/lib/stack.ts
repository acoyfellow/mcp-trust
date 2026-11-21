import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Urls {
  readonly acmeUrl: string;
  readonly impostorUrl: string;
  readonly gatewayUrl: string;
  readonly agentUrl: string;
}

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const run = async (cmd: string[], env: Record<string, string | undefined> = process.env) => {
  const proc = Bun.spawn(cmd, { cwd: repoRoot, env, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return out + err;
};

export const assertAccountMatchesProfile = async (): Promise<{ profile: string }> => {
  const profile = process.env.ALCHEMY_PROFILE;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!profile || !account) {
    throw new Error(
      "Set ALCHEMY_PROFILE and CLOUDFLARE_ACCOUNT_ID. The experiments create real KV namespaces.",
    );
  }
  const shown = await run([
    "bunx",
    "alchemy",
    "profile",
    "show",
    "--profile",
    profile,
    "--no-input",
  ]);
  const match = shown.match(/accountId:\s*([0-9a-f]{32})/);
  if (!match || match[1] !== account) {
    throw new Error(
      `Alchemy profile "${profile}" does not point at CLOUDFLARE_ACCOUNT_ID. Refusing to create resources in the wrong account.`,
    );
  }
  return { profile };
};

const killRepoWorkerd = async () => {
  const listed = await run(["pgrep", "-f", `${repoRoot}/node_modules/@cloudflare/workerd`]);
  for (const pid of listed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+$/.test(l))) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {}
  }
};

export const withStack = async <T>(fn: (urls: Urls) => Promise<T>): Promise<T> => {
  await assertAccountMatchesProfile();
  if (process.env.MCP_TRUST_URLS) return fn(JSON.parse(process.env.MCP_TRUST_URLS) as Urls);
  const proc = Bun.spawn(["bunx", "alchemy", "dev", "--no-input", "--stage", "mcp_trust_run"], {
    cwd: repoRoot,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  let log = "";
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      log += decoder.decode(value);
    }
  };
  void pump(proc.stdout);
  void pump(proc.stderr);
  try {
    const started = Date.now();
    while (!/Done:/.test(log)) {
      if (Date.now() - started > 180_000)
        throw new Error(`stack did not start:\n${log.slice(-2000)}`);
      await Bun.sleep(500);
    }
    const urls: Record<string, string> = {};
    for (const m of log.matchAll(/(\w+Url): '([^']+)'/g)) urls[m[1] as string] = m[2] as string;
    return await fn(urls as unknown as Urls);
  } finally {
    proc.kill("SIGTERM");
    await Promise.race([proc.exited, Bun.sleep(10_000)]);
    await killRepoWorkerd();
  }
};
