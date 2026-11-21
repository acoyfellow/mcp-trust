import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const rex = async (args: ReadonlyArray<string>): Promise<string> => {
  const proc = Bun.spawn(["rex", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`rex ${args[0]} failed: ${err.trim().slice(0, 200)}`);
  return out;
};

const rexSession = (): string => {
  const session = process.env.REX_SESSION;
  if (!session) throw new Error("REX_SESSION is not set. Run this inside a Rex terminal.");
  return session;
};

export interface Pane {
  readonly blockId: string;
  readonly out: string;
}

export interface PaneOptions {
  readonly gateway: string;
  readonly out?: string | undefined;
  readonly after?: number | undefined;
}

export const startPane = async (options: PaneOptions): Promise<Pane> => {
  const block = process.env.REX_BLOCK;
  if (!block) throw new Error("REX_BLOCK is not set. Run this inside a Rex terminal.");
  const out = resolve(options.out ?? `${repoRoot}/flight.jsonl`);
  const created = await rex([
    "split",
    "-s",
    rexSession(),
    "-b",
    block,
    "--split=right",
    "--focus=false",
    "--label",
    "mcp-trust",
    "--json",
    "-c",
    repoRoot,
    "--",
    "bun",
    `${repoRoot}/bin/mcp-trust.ts`,
    "record",
    "--gateway",
    options.gateway,
    "--out",
    out,
    "--after",
    String(options.after ?? 0),
  ]);
  const blockId = (JSON.parse(created) as { block_ids?: string[] }).block_ids?.[0];
  if (!blockId) throw new Error("rex split did not return a block id");
  return { blockId, out };
};

export const paneCapture = (blockId: string): Promise<string> =>
  rex(["capture", "-s", rexSession(), "-b", blockId, "--unwrap", "--trim"]);

export const closePane = async (blockId: string): Promise<void> => {
  await rex(["block", "close", "-s", rexSession(), blockId]);
};
