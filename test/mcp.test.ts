import { expect, test } from "bun:test";
import { serveRpc, text } from "../src/mcp/rpc.ts";

interface Reply {
  readonly result: {
    serverInfo: { name: string };
    tools: Array<{ name: string }>;
    content: Array<{ text: string }>;
  };
  readonly error: { code: number };
}

import { schemaHash } from "../src/mcp/schema-hash.ts";
import { parseTargets, writeTarget } from "../src/targets.ts";

const handlers = {
  serverName: "t",
  listTools: async () => [{ name: "echo", description: "d", inputSchema: { type: "object" } }],
  callTool: async (name: string, args: Record<string, unknown>) =>
    text(`${name}:${JSON.stringify(args)}`),
};

test("serveRpc answers initialize, tools/list and tools/call, and ignores notifications", async () => {
  const init = (await serveRpc(
    { jsonrpc: "2.0", id: 1, method: "initialize" },
    handlers,
  )) as unknown as Reply;
  expect(init.result.serverInfo.name).toBe("t");
  const list = (await serveRpc(
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    handlers,
  )) as unknown as Reply;
  expect(list.result.tools[0].name).toBe("echo");
  const call = (await serveRpc(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { a: 1 } } },
    handlers,
  )) as unknown as Reply;
  expect(call.result.content[0].text).toBe('echo:{"a":1}');
  expect(
    await serveRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, handlers),
  ).toBeNull();
  const unknown = (await serveRpc(
    { jsonrpc: "2.0", id: 4, method: "nope" },
    handlers,
  )) as unknown as Reply;
  expect(unknown.error.code).toBe(-32601);
});

test("schemaHash ignores key order and changes with the schema", async () => {
  const a = await schemaHash({
    name: "x",
    description: "d",
    inputSchema: { a: 1, b: { c: 2, d: 3 } },
  });
  const b = await schemaHash({
    name: "x",
    description: "d",
    inputSchema: { b: { d: 3, c: 2 }, a: 1 },
  });
  const c = await schemaHash({
    name: "x",
    description: "d2",
    inputSchema: { a: 1, b: { c: 2, d: 3 } },
  });
  expect(a).toBe(b);
  expect(a).not.toBe(c);
});

test("parseTargets reads only known namespaces from the prompt", () => {
  expect(parseTargets("Save a summary to scratch:summaries/a-1, please.")).toEqual([
    "scratch:summaries/a-1",
  ]);
  expect(parseTargets("Write scratch:a and scratch:b/c.d; skip decoy:x")).toEqual([
    "scratch:a",
    "scratch:b/c.d",
    "decoy:x",
  ]);
  expect(parseTargets("see https://example.com:8080/x and notscratch:a")).toEqual([]);
  expect(parseTargets("no targets here")).toEqual([]);
});

test("writeTarget maps write tools to namespace:key and leaves other tools alone", () => {
  expect(writeTarget("kv_put", { namespace: "decoy", key: "k", value: "v" })).toBe("decoy:k");
  expect(writeTarget("kv_delete", { namespace: "scratch", key: "k" })).toBe("scratch:k");
  expect(writeTarget("kv_put", { key: "k" })).toBe("");
  expect(writeTarget("read_document", { name: "n" })).toBeNull();
});
