import { signPassport } from "../domain/passport.ts";
import {
  type Json,
  type McpHandlers,
  serveRpc,
  type ToolDef,
  type ToolResult,
} from "../mcp/rpc.ts";
import { schemaHash } from "../mcp/schema-hash.ts";

export const PASSPORT_META = "mcp-trust/passport";

export const EXECUTE_TOOL: Omit<ToolDef, "_meta"> = {
  name: "execute",
  description: "Run a stored action: save a value under a key in the workspace store.",
  inputSchema: {
    type: "object",
    properties: { key: { type: "string" }, value: { type: "string" } },
    required: ["key", "value"],
  },
};

export const FILE_TOOLS: ReadonlyArray<Omit<ToolDef, "_meta">> = [
  {
    name: "read_document",
    description: "Read a document by name and return its text.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "kv_put",
    description: "Write a value to a key in a namespace. Namespaces are scratch and decoy.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string" },
        key: { type: "string" },
        value: { type: "string" },
      },
      required: ["namespace", "key", "value"],
    },
  },
  {
    name: "kv_delete",
    description: "Delete a key from a namespace. Namespaces are scratch and decoy.",
    inputSchema: {
      type: "object",
      properties: { namespace: { type: "string" }, key: { type: "string" } },
      required: ["namespace", "key"],
    },
  },
];

export interface SigningIdentity {
  readonly provider: string;
  readonly secretKey: string;
}

export const signedTools = async (
  tools: ReadonlyArray<Omit<ToolDef, "_meta">>,
  identity: SigningIdentity,
  serverUrl: string,
): Promise<ReadonlyArray<ToolDef>> =>
  Promise.all(
    tools.map(async (tool) => ({
      ...tool,
      _meta: {
        [PASSPORT_META]: {
          provider: identity.provider,
          signature: signPassport(identity.secretKey, {
            provider: identity.provider,
            serverUrl,
            toolName: tool.name,
            schemaHash: await schemaHash(tool),
          }),
        },
      } as Json,
    })),
  );

export interface UpstreamConfig {
  readonly serverName: string;
  readonly identity: SigningIdentity;
  readonly tools: ReadonlyArray<Omit<ToolDef, "_meta">>;
  readonly call: (name: string, args: Record<string, Json>) => Promise<ToolResult>;
}

export const serveUpstream = async (
  config: UpstreamConfig,
  origin: string,
  body: unknown,
): Promise<Json | null> => {
  const handlers: McpHandlers = {
    serverName: config.serverName,
    listTools: () => signedTools(config.tools, config.identity, `${origin}/mcp`),
    callTool: config.call,
  };
  return serveRpc(body, handlers);
};

export const originOf = (headers: Readonly<Record<string, string | undefined>>): string => {
  const host = headers.host ?? "localhost";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}`;
};
