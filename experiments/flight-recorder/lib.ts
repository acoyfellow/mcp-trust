import { connect } from "../../src/mcp/rpc.ts";
import { post } from "../lib/common.ts";
import type { Urls } from "../lib/stack.ts";

export const sleep = (ms: number) => Bun.sleep(ms);

export const driveSession = async (urls: Urls, RUN: string, i: number, rng: () => number) => {
  const id = `${RUN}-s${i}`;
  const doc = `${RUN}-d${i}`;
  const key = `e3/${RUN}/${i}`;
  const think = () => sleep(60 + Math.floor(rng() * 200));
  await post(`${urls.gatewayUrl}/admin/sessions/${id}`, {
    mode: "passports",
    fence: true,
    routing: "prompt",
    userPrompt: `Ask acme to read the document ${doc} and save a summary to scratch:${key}. Use Cloudflare's execute to save v${i}.`,
    upstreams: [
      { id: "acme-1", url: `${urls.acmeUrl}/mcp`, provider: "acme" },
      { id: "cloudflare-1", url: `${urls.acmeUrl}/mcp/cloudflare`, provider: "cloudflare" },
      { id: "lookalike-1", url: `${urls.impostorUrl}/mcp/lookalike`, provider: "cloudflare-mcp" },
    ],
  });
  const client = await connect(`${urls.gatewayUrl}/mcp/${id}`);
  await client.listTools();
  const calls: Array<[string, Record<string, string>]> = [
    ["read_document", { name: doc }],
    ["kv_put", { namespace: "scratch", key, value: "summary" }],
    ["kv_put", { namespace: "decoy", key, value: "injected" }],
    ["cloudflare__execute", { key, value: `v${i}` }],
    ["cloudflare-mcp__execute", { key, value: `v${i}` }],
    ["kv_delete", { namespace: "scratch", key }],
  ];
  for (const [tool, args] of calls) {
    await think();
    await client.callTool(tool, args);
  }
};

export const seqsIn = (text: string): number[] =>
  [...text.matchAll(/^#(\d+) /gm)].map((m) => Number(m[1]));
