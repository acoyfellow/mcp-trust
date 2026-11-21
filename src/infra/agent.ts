import * as Cloudflare from "@alchemy.run/cloudflare";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { connect, type Json, type ToolDef } from "../mcp/rpc.ts";

export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM =
  "You are an assistant that completes the user's task by calling the provided tools. " +
  "Call a tool whenever the task needs one. When the task is done, reply with one short sentence.";

interface RunRequest {
  readonly gateway: string;
  readonly task: string;
  readonly maxSteps?: number;
}

interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, Json>;
}

interface Message {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly tool_call_id?: string;
  readonly name?: string;
  readonly tool_calls?: ReadonlyArray<{
    readonly id: string;
    readonly type: "function";
    readonly function: { readonly name: string; readonly arguments: string };
  }>;
}

const parseCalls = (out: Record<string, unknown>): { text: string; calls: ToolCall[] } => {
  const choice = (out.choices as Array<{ message?: Record<string, unknown> }> | undefined)?.[0]
    ?.message;
  const raw = (choice?.tool_calls ?? out.tool_calls ?? []) as Array<Record<string, unknown>>;
  const calls = raw.map((c, i) => {
    const fn = (c.function ?? c) as { name?: string; arguments?: unknown };
    const args =
      typeof fn.arguments === "string"
        ? (JSON.parse(fn.arguments || "{}") as Record<string, Json>)
        : ((fn.arguments ?? {}) as Record<string, Json>);
    return { id: String(c.id ?? `call_${i}`), name: String(fn.name ?? ""), args };
  });
  const content = choice?.content ?? out.response ?? "";
  return { text: typeof content === "string" ? content : "", calls };
};

export default class Agent extends Cloudflare.Worker<Agent>()(
  "Agent",
  { main: import.meta.url },
  Effect.gen(function* () {
    const ai = yield* Cloudflare.Workers.AI();

    const run = (request: RunRequest) =>
      Effect.gen(function* () {
        const client = yield* Effect.promise(() => connect(request.gateway));
        const tools: ReadonlyArray<ToolDef> = yield* Effect.promise(() => client.listTools());
        const messages: Array<Message> = [
          { role: "system", content: SYSTEM },
          { role: "user", content: request.task },
        ];
        const calls: Array<{
          tool: string;
          args: Record<string, Json>;
          result: string;
          isError: boolean;
          meta: Json | null;
        }> = [];
        let neurons = 0;
        let aiCalls = 0;
        let final = "";
        for (let step = 0; step < (request.maxSteps ?? 6); step++) {
          const out = (yield* ai
            .run(MODEL, {
              messages,
              tools: tools.map((t) => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
              })),
              max_tokens: 512,
            } as never)
            .pipe(Effect.orDie)) as unknown as Record<string, unknown>;
          aiCalls += 1;
          neurons += Number((out.usage as { neurons?: number } | undefined)?.neurons ?? 0);
          const parsed = parseCalls(out);
          if (parsed.calls.length === 0) {
            final = parsed.text;
            break;
          }
          messages.push({
            role: "assistant",
            content: parsed.text,
            tool_calls: parsed.calls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            })),
          });
          for (const call of parsed.calls) {
            const result = yield* Effect.promise(() => client.callTool(call.name, call.args));
            const resultText = result.content.map((c) => c.text).join("\n");
            calls.push({
              tool: call.name,
              args: call.args,
              result: resultText,
              isError: result.isError === true,
              meta: (result._meta as Json | undefined) ?? null,
            });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              name: call.name,
              content: resultText,
            });
          }
        }
        return {
          model: MODEL,
          toolsOffered: tools.map((t) => t.name),
          calls,
          final,
          neurons,
          aiCalls,
        };
      });

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const url = new URL(request.url, "http://worker");
        if (url.pathname === "/run" && request.method === "POST") {
          const body = (yield* request.json) as unknown as RunRequest;
          const ctx = yield* Effect.context<RuntimeContext>();
          const result = yield* Effect.promise(() => Effect.runPromiseWith(ctx)(run(body)));
          return yield* HttpServerResponse.json(result);
        }
        return HttpServerResponse.text("agent", { status: 404 });
      }).pipe(Effect.orDie),
    };
  }).pipe(Effect.provide(Cloudflare.Workers.AIBinding)),
) {}
