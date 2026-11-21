export type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
  | { readonly [k: string]: Json };

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Json;
  readonly _meta?: Json;
}

export interface ToolResult {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  readonly isError?: boolean;
  readonly _meta?: Json;
}

export interface McpHandlers {
  readonly serverName: string;
  readonly listTools: () => Promise<ReadonlyArray<ToolDef>>;
  readonly callTool: (name: string, args: Record<string, Json>) => Promise<ToolResult>;
}

interface RpcMessage {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, Json>;
}

export const PROTOCOL_VERSION = "2025-06-18";

const ok = (id: RpcMessage["id"], result: Json) => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: RpcMessage["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

export const text = (value: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError: true } : {}),
});

export const serveRpc = async (body: unknown, handlers: McpHandlers): Promise<Json | null> => {
  const message = body as RpcMessage;
  if (message === null || typeof message !== "object" || typeof message.method !== "string") {
    return fail(null, -32600, "invalid request") as Json;
  }
  if (message.id === undefined) return null;
  switch (message.method) {
    case "initialize":
      return ok(message.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: handlers.serverName, version: "0.0.1" },
      }) as Json;
    case "ping":
      return ok(message.id, {}) as Json;
    case "tools/list":
      return ok(message.id, { tools: (await handlers.listTools()) as unknown as Json }) as Json;
    case "tools/call": {
      const name = message.params?.name;
      const args = message.params?.arguments;
      if (typeof name !== "string") return fail(message.id, -32602, "name is required") as Json;
      const result = await handlers.callTool(
        name,
        args !== null && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, Json>)
          : {},
      );
      return ok(message.id, result as unknown as Json) as Json;
    }
    default:
      return fail(message.id, -32601, `method not found: ${message.method}`) as Json;
  }
};

const parseBody = async (
  response: Response,
): Promise<{ result?: Json; error?: { message: string } }> => {
  const type = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  if (type.includes("text/event-stream")) {
    const data = raw
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .pop();
    return data === undefined ? {} : JSON.parse(data);
  }
  return raw === "" ? {} : JSON.parse(raw);
};

export interface McpClient {
  readonly listTools: () => Promise<ReadonlyArray<ToolDef>>;
  readonly callTool: (name: string, args: Record<string, Json>) => Promise<ToolResult>;
}

export const connect = async (url: string): Promise<McpClient> => {
  let nextId = 1;
  let sessionId: string | null = null;
  const send = async (method: string, params: Json, notify = false) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId === null ? {} : { "mcp-session-id": sessionId }),
      },
      body: JSON.stringify(
        notify
          ? { jsonrpc: "2.0", method, params }
          : { jsonrpc: "2.0", id: nextId++, method, params },
      ),
    });
    const sid = response.headers.get("mcp-session-id");
    if (sid !== null) sessionId = sid;
    if (notify) {
      await response.text();
      return {};
    }
    if (!response.ok) throw new Error(`MCP ${method} to ${url} failed: ${response.status}`);
    const parsed = await parseBody(response);
    if (parsed.error !== undefined) throw new Error(`MCP ${method} error: ${parsed.error.message}`);
    return parsed.result as Json;
  };
  await send("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "mcp-trust", version: "0.0.1" },
  });
  await send("notifications/initialized", {}, true);
  return {
    listTools: async () =>
      ((await send("tools/list", {})) as unknown as { tools: ReadonlyArray<ToolDef> }).tools,
    callTool: async (name, args) =>
      (await send("tools/call", { name, arguments: args })) as unknown as ToolResult,
  };
};
