import * as Cloudflare from "@alchemy.run/cloudflare";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { MODEL, type RunRequest, runAgent } from "../agent-loop.ts";

export default class Agent extends Cloudflare.Worker<Agent>()(
  "Agent",
  { main: import.meta.url },
  Effect.gen(function* () {
    const ai = yield* Cloudflare.Workers.AI();

    const run = (request: RunRequest) =>
      Effect.gen(function* () {
        const ctx = yield* Effect.context<RuntimeContext>();
        return yield* Effect.promise(() =>
          runAgent(
            (input) => Effect.runPromiseWith(ctx)(ai.run(MODEL, input as never).pipe(Effect.orDie)),
            request,
          ),
        );
      });

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const url = new URL(request.url, "http://worker");
        if (url.pathname === "/run" && request.method === "POST") {
          const body = (yield* request.json) as unknown as RunRequest;
          const result = yield* run(body);
          return yield* HttpServerResponse.json(result);
        }
        return HttpServerResponse.text("agent", { status: 404 });
      }).pipe(Effect.orDie),
    };
  }).pipe(Effect.provide(Cloudflare.Workers.AIBinding)),
) {}
