import * as Cloudflare from "@alchemy.run/cloudflare";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Json } from "../mcp/rpc.ts";
import { text } from "../mcp/rpc.ts";
import { Decoy, Scratch } from "./kv.ts";
import { ACME_KEY } from "./test-keys.ts";
import { EXECUTE_TOOL, FILE_TOOLS, originOf, serveUpstream } from "./upstream.ts";

export default class Acme extends Cloudflare.Worker<Acme>()(
  "Acme",
  { main: import.meta.url },
  Effect.gen(function* () {
    const scratch = yield* Cloudflare.KV.ReadWriteNamespace(Scratch);
    const decoy = yield* Cloudflare.KV.ReadWriteNamespace(Decoy);
    const store = (name: unknown) =>
      name === "decoy" ? decoy : name === "scratch" ? scratch : null;

    const makeCall =
      (run: <A, E>(e: Effect.Effect<A, E, RuntimeContext>) => Promise<A>) =>
      async (name: string, args: Record<string, Json>) => {
        if (name === "execute") {
          await run(scratch.put(String(args.key), `acme:${String(args.value)}`));
          return text(`stored ${String(args.key)}`);
        }
        if (name === "read_document") {
          const doc = await run(scratch.get(`doc/${String(args.name)}`));
          return doc === null ? text("document not found", true) : text(doc);
        }
        const ns = store(args.namespace);
        if (ns === null) return text("unknown namespace", true);
        if (name === "kv_put") {
          await run(ns.put(String(args.key), String(args.value)));
          return text(`wrote ${String(args.namespace)}:${String(args.key)}`);
        }
        if (name === "kv_delete") {
          await run(ns.delete(String(args.key)));
          return text(`deleted ${String(args.namespace)}:${String(args.key)}`);
        }
        return text(`unknown tool ${name}`, true);
      };

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const url = new URL(request.url, "http://worker");
        const ctx = yield* Effect.context<RuntimeContext>();
        const call = makeCall((e) => Effect.runPromiseWith(ctx)(e));
        if (url.pathname === "/admin/kv" && request.method === "GET") {
          const ns = store(url.searchParams.get("ns"));
          const value = ns === null ? null : yield* ns.get(url.searchParams.get("key") ?? "");
          return yield* HttpServerResponse.json({ value });
        }
        if (url.pathname === "/admin/kv-list" && request.method === "GET") {
          const ns = store(url.searchParams.get("ns"));
          if (ns === null)
            return yield* HttpServerResponse.json({ error: "namespace" }, { status: 400 });
          const page = yield* ns.list({ prefix: url.searchParams.get("prefix") ?? "" });
          return yield* HttpServerResponse.json({
            keys: page.keys.map((k: { name: string }) => k.name),
          });
        }
        if (url.pathname === "/admin/kv" && request.method === "POST") {
          const body = (yield* request.json) as { ns: string; key: string; value?: string };
          const ns = store(body.ns);
          if (ns === null)
            return yield* HttpServerResponse.json({ error: "namespace" }, { status: 400 });
          if (body.value === undefined) yield* ns.delete(body.key);
          else yield* ns.put(body.key, body.value);
          return yield* HttpServerResponse.json({ ok: true });
        }
        if (url.pathname === "/mcp" && request.method === "POST") {
          const body = yield* request.json;
          const reply = yield* Effect.promise(() =>
            serveUpstream(
              {
                serverName: "acme",
                identity: { provider: "acme", secretKey: ACME_KEY.secretKey },
                tools: [EXECUTE_TOOL, ...FILE_TOOLS],
                call,
              },
              originOf(request.headers),
              body,
            ),
          );
          return reply === null
            ? HttpServerResponse.empty({ status: 202 })
            : yield* HttpServerResponse.json(reply);
        }
        return HttpServerResponse.text("acme", { status: 404 });
      }).pipe(Effect.orDie),
    };
  }).pipe(Effect.provide(Cloudflare.KV.ReadWriteNamespaceBinding)),
) {}
