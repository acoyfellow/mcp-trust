import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { repoRoot } from "./stack.ts";

export const post = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`POST ${url} -> ${response.status}: ${raw.slice(0, 300)}`);
  return JSON.parse(raw) as T;
};

export const kvGet = async (acme: string, ns: string, key: string): Promise<string | null> =>
  (
    (await (await fetch(`${acme}/admin/kv?ns=${ns}&key=${encodeURIComponent(key)}`)).json()) as {
      value: string | null;
    }
  ).value;

export const kvPut = (acme: string, ns: string, key: string, value: string) =>
  post(`${acme}/admin/kv`, { ns, key, value });

export const kvDelete = (acme: string, ns: string, key: string) =>
  post(`${acme}/admin/kv`, { ns, key });

export const kvList = async (
  acme: string,
  ns: string,
  prefix = "",
): Promise<ReadonlyArray<string>> =>
  (
    (await (
      await fetch(`${acme}/admin/kv-list?ns=${ns}&prefix=${encodeURIComponent(prefix)}`)
    ).json()) as { keys: string[] }
  ).keys;

export const pool = async <T, R>(
  concurrency: number,
  items: ReadonlyArray<T>,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i] as T, i);
      }
    }),
  );
  return results;
};

export const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const percentile = (values: ReadonlyArray<number>, p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number;
};

const sh = (cmd: string[]) => {
  const out = Bun.spawnSync(cmd, { cwd: repoRoot });
  return new TextDecoder().decode(out.stdout).trim();
};

export const gitInfo = () => ({
  commit: sh(["git", "rev-parse", "HEAD"]),
  dirty: sh(["git", "status", "--porcelain"]) !== "",
});

export interface Receipt {
  readonly schema: "mcp-trust/receipt/v1";
  readonly experiment: string;
  readonly claimId: string;
  readonly verdict: "verified" | "verified-disproved" | "inconclusive";
  readonly intent: string;
  readonly environment?: "local" | "deployed";
  readonly execution: Record<string, unknown>;
  readonly evidence: { observed: unknown; projected: unknown; realized: unknown };
  readonly constraintCleared: ReadonlyArray<{ constraint: string; met: boolean; how: string }>;
  readonly cost: Record<string, unknown>;
}

export const writeReceipt = (path: string, receipt: Receipt) => {
  const full = `${repoRoot}/${path}`;
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${JSON.stringify(receipt, null, 2)}\n`);
};
