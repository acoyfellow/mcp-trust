import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { type AccessConfig, checkAccess } from "../access/jwt.ts";
import { FlightLog, type FlightLogged, rowOf } from "../domain/flight-log.ts";
import { SessionId, THE_FLIGHT } from "../domain/ids.ts";
import { RecordRefusal, Refusals, type RejectionName } from "../domain/refusals.ts";
import { RegisterServer, RegisterTool, RouteCall, ToolRegistry } from "../domain/tool-registry.ts";
import { NameTargets, RequestWrite, WriteFence } from "../domain/write-fence.ts";
import { McpTrustOnDurableObjects } from "../host.ts";
import {
  connect,
  type Json,
  type McpClient,
  serveRpc,
  type ToolDef,
  type ToolResult,
  text,
} from "../mcp/rpc.ts";
import { schemaHash } from "../mcp/schema-hash.ts";
import { parseProviders, parseTargets, writeTarget } from "../targets.ts";
import { PINNED_KEYS } from "./test-keys.ts";
import { PASSPORT_META } from "./upstream.ts";

interface UpstreamConfig {
  readonly id: string;
  readonly url: string;
  readonly provider: string;
}

interface CatalogEntry {
  readonly tool: ToolDef;
  readonly server: string;
  readonly provider: string;
}

interface Session {
  readonly mode: "passports" | "naive";
  readonly fence: boolean;
  readonly routing: "model" | "prompt";
  readonly userPrompt: string;
  readonly catalog: Array<CatalogEntry>;
  readonly clients: Map<string, McpClient>;
}

const sessions = new Map<string, Session>();

const wireOf = (entry: {
  readonly event: unknown;
  readonly envelope: { readonly seq: number };
}) => {
  const logged = entry.event as FlightLogged;
  const event = logged.event as { _tag: string };
  return {
    seq: entry.envelope.seq,
    at: logged.at,
    source: logged.source,
    event,
    row: rowOf({ seq: entry.envelope.seq, at: logged.at, session: logged.session, event }),
  };
};

const frame = (wire: { readonly seq: number }): string =>
  `id: ${wire.seq}\ndata: ${JSON.stringify(wire)}\n\n`;

type RejectionTag = typeof RejectionName.Type;
const REJECTION_TAGS: ReadonlySet<string> = new Set<RejectionTag>([
  "ServerAlreadyRegistered",
  "UnverifiedPassport",
  "AmbiguousTool",
  "Misbinding",
  "ProviderNotNamed",
  "TargetNotNamed",
  "TargetsNotDeclared",
]);

const qualified = (provider: string, name: string) => `${provider}__${name}`;

const recoveryHint = (session: Session, tool: string, named: ReadonlyArray<string>): string => {
  const options = session.catalog
    .filter((c) => c.tool.name === tool && named.includes(c.provider))
    .map((c) => exposedName(c, session.catalog));
  const asked = named.length > 0 ? named.join(", ") : "no provider";
  return options.length > 0
    ? ` The user asked for provider ${asked}. Call ${options.join(" or ")} instead.`
    : ` The user asked for provider ${asked}, and that provider has no tool ${tool}.`;
};

const exposedName = (entry: CatalogEntry, catalog: ReadonlyArray<CatalogEntry>): string => {
  const providers = new Set(
    catalog.filter((c) => c.tool.name === entry.tool.name).map((c) => c.provider),
  );
  return providers.size > 1 ? qualified(entry.provider, entry.tool.name) : entry.tool.name;
};

export default class Gateway extends Cloudflare.Worker<Gateway>()(
  "Gateway",
  { main: import.meta.url },
  Effect.gen(function* () {
    const registry = yield* ToolRegistry;
    const fence = yield* WriteFence;
    const refusals = yield* Refusals;
    const log = yield* FlightLog;
    const accessAud = yield* Config.option(Config.String("ACCESS_AUD"));
    const accessTeam = yield* Config.option(Config.String("ACCESS_TEAM_DOMAIN"));
    const accessCerts = yield* Config.option(Config.String("ACCESS_CERTS_URL"));
    const access: AccessConfig | null =
      Option.isSome(accessAud) && Option.isSome(accessTeam)
        ? {
            aud: accessAud.value,
            teamDomain: accessTeam.value,
            certsUrl: Option.getOrUndefined(accessCerts),
          }
        : null;

    const refuse = (
      sessionId: SessionId,
      tag: string,
      fields: {
        tool: string | null;
        server: string | null;
        provider: string | null;
        target: string | null;
      },
    ) =>
      REJECTION_TAGS.has(tag) ? yield_refusal(sessionId, tag as RejectionTag, fields) : Effect.void;

    const yield_refusal = (
      sessionId: SessionId,
      rejection: RejectionTag,
      fields: {
        tool: string | null;
        server: string | null;
        provider: string | null;
        target: string | null;
      },
    ) =>
      Effect.asVoid(
        Effect.result(refusals.send(sessionId, new RecordRefusal({ rejection, ...fields }))),
      );

    const configure = (
      sessionId: SessionId,
      body: {
        mode: "passports" | "naive";
        fence: boolean;
        routing?: "model" | "prompt";
        userPrompt?: string;
        upstreams: ReadonlyArray<UpstreamConfig>;
      },
    ) =>
      Effect.gen(function* () {
        const session: Session = {
          mode: body.mode,
          fence: body.fence,
          routing: body.routing ?? "model",
          userPrompt: body.userPrompt ?? "",
          catalog: [],
          clients: new Map(),
        };
        sessions.set(sessionId, session);
        if (body.fence) {
          yield* fence.send(
            sessionId,
            new NameTargets({ targets: parseTargets(body.userPrompt ?? "") }),
          );
        }
        for (const upstream of body.upstreams) {
          const client = yield* Effect.promise(() => connect(upstream.url));
          session.clients.set(upstream.id, client);
          const tools = yield* Effect.promise(() => client.listTools());
          if (body.mode === "naive") {
            for (const tool of tools) {
              session.catalog.push({ tool, server: upstream.id, provider: upstream.provider });
            }
            continue;
          }
          const pinned = Object.hasOwn(PINNED_KEYS, upstream.provider)
            ? PINNED_KEYS[upstream.provider]
            : undefined;
          if (pinned === undefined) {
            yield* refuse(sessionId, "UnverifiedPassport", {
              tool: null,
              server: upstream.id,
              provider: upstream.provider,
              target: null,
            });
            continue;
          }
          const registered = yield* Effect.result(
            registry.send(
              sessionId,
              new RegisterServer({
                serverId: upstream.id,
                provider: upstream.provider,
                publicKey: pinned,
                url: upstream.url,
              }),
            ),
          );
          if (Result.isFailure(registered)) {
            yield* refuse(sessionId, registered.failure._tag, {
              tool: null,
              server: upstream.id,
              provider: upstream.provider,
              target: null,
            });
            continue;
          }
          for (const tool of tools) {
            const meta = tool._meta as { [k: string]: { signature?: string } } | undefined;
            const signature = meta?.[PASSPORT_META]?.signature ?? "";
            const hash = yield* Effect.promise(() => schemaHash(tool));
            const result = yield* Effect.result(
              registry.send(
                sessionId,
                new RegisterTool({
                  name: tool.name,
                  server: upstream.id,
                  schemaHash: hash,
                  signature,
                }),
              ),
            );
            if (Result.isFailure(result)) {
              yield* refuse(sessionId, result.failure._tag, {
                tool: tool.name,
                server: upstream.id,
                provider: upstream.provider,
                target: null,
              });
            } else {
              session.catalog.push({ tool, server: upstream.id, provider: upstream.provider });
            }
          }
        }
        return {
          catalog: session.catalog.map((c) => ({
            name: c.tool.name,
            server: c.server,
            provider: c.provider,
          })),
        };
      });

    const listTools = (session: Session): ReadonlyArray<ToolDef> =>
      session.catalog.map((entry) => ({
        name: session.mode === "naive" ? entry.tool.name : exposedName(entry, session.catalog),
        description: entry.tool.description,
        inputSchema: entry.tool.inputSchema,
      }));

    const callTool = (
      sessionId: SessionId,
      session: Session,
      name: string,
      args: Record<string, Json>,
    ) =>
      Effect.gen(function* () {
        const meta = (extra: Record<string, Json>): Json => ({ "mcp-trust": extra });
        let target: CatalogEntry | undefined;
        let provider: string | null = null;
        let bareTool = name;
        if (session.mode === "naive") {
          target = session.catalog.find((c) => c.tool.name === name);
        } else {
          const matches = session.catalog.filter((c) => c.tool.name === name);
          const viaQualified = session.catalog.find(
            (c) => qualified(c.provider, c.tool.name) === name,
          );
          if (viaQualified !== undefined) {
            provider = viaQualified.provider;
            bareTool = viaQualified.tool.name;
            target = viaQualified;
          } else {
            target = matches[0];
          }
          const named =
            session.routing === "prompt"
              ? parseProviders(session.userPrompt, [
                  ...new Set(session.catalog.map((c) => c.provider)),
                ])
              : null;
          const routed = yield* Effect.result(
            registry.send(
              sessionId,
              new RouteCall({ tool: bareTool, server: target?.server ?? "", provider, named }),
            ),
          );
          if (Result.isFailure(routed)) {
            yield* refuse(sessionId, routed.failure._tag, {
              tool: bareTool,
              server: target?.server ?? null,
              provider,
              target: null,
            });
            const hint =
              routed.failure._tag === "ProviderNotNamed"
                ? recoveryHint(session, bareTool, routed.failure.named)
                : "";
            return {
              ...text(`blocked by gateway: ${routed.failure._tag}.${hint}`, true),
              _meta: meta({ blocked: routed.failure._tag }),
            } as ToolResult;
          }
        }
        if (target === undefined) {
          return {
            ...text(`unknown tool ${name}`, true),
            _meta: meta({ blocked: "UnknownTool" }),
          } as ToolResult;
        }
        let fenceMs: number | null = null;
        if (session.fence) {
          const writeTo = writeTarget(bareTool, args) ?? "";
          const started = performance.now();
          const decided = yield* Effect.result(
            fence.send(sessionId, new RequestWrite({ tool: bareTool, target: writeTo })),
          );
          fenceMs = performance.now() - started;
          if (Result.isFailure(decided)) {
            yield* refuse(sessionId, decided.failure._tag, {
              tool: bareTool,
              server: target.server,
              provider: target.provider,
              target: writeTo,
            });
            return {
              ...text(`blocked by gateway: ${decided.failure._tag}`, true),
              _meta: meta({ blocked: decided.failure._tag, fenceMs, target: writeTo }),
            } as ToolResult;
          }
        }
        const client = session.clients.get(target.server);
        if (client === undefined) return text("upstream not connected", true);
        const result = yield* Effect.promise(() => client.callTool(bareTool, args));
        return {
          ...result,
          _meta: meta({ server: target.server, provider: target.provider, fenceMs }),
        } as ToolResult;
      });

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const url = new URL(request.url, "http://worker");
        const parts = url.pathname.split("/").filter(Boolean);

        if (access !== null) {
          const checked = yield* Effect.promise(() => checkAccess(request.headers, access));
          if (!checked.ok) {
            return yield* HttpServerResponse.json(
              { error: "forbidden", reason: checked.reason },
              { status: 403 },
            );
          }
        }

        if (
          parts[0] === "admin" &&
          parts[1] === "sessions" &&
          parts[2] &&
          request.method === "POST"
        ) {
          const body = (yield* request.json) as unknown as Parameters<typeof configure>[1];
          const out = yield* configure(SessionId.make(parts[2]), body);
          return yield* HttpServerResponse.json(out);
        }

        if (
          parts[0] === "admin" &&
          parts[1] === "flight" &&
          parts[2] === "head" &&
          request.method === "GET"
        ) {
          const snapshot = yield* log.snapshot(THE_FLIGHT);
          return yield* HttpServerResponse.json({ cursor: snapshot.cursor ?? 0 });
        }

        if (
          parts[0] === "admin" &&
          parts[1] === "flight" &&
          parts[2] === "stream" &&
          request.method === "GET"
        ) {
          const after = Number(
            url.searchParams.get("after") ?? request.headers["last-event-id"] ?? 0,
          );
          const frames = log
            .events(THE_FLIGHT, { after })
            .pipe(Stream.map((entry) => frame(wireOf(entry))));
          const heartbeat = Stream.fromSchedule(Schedule.spaced("15 seconds")).pipe(
            Stream.map(() => ": ping\n\n"),
          );
          return HttpServerResponse.stream(
            Stream.merge(frames, heartbeat).pipe(Stream.encodeText),
            {
              contentType: "text/event-stream",
              headers: { "cache-control": "no-store", "x-accel-buffering": "no" },
            },
          );
        }

        if (parts[0] === "admin" && parts[1] === "flight" && request.method === "GET") {
          const rows: Array<unknown> = [];
          for (let after = 0; ; ) {
            const page = yield* log.list(THE_FLIGHT, { after, take: 500 });
            for (const entry of page.entries) rows.push(wireOf(entry).row);
            if (page.cursor === null || page.entries.length === 0) break;
            after = page.cursor;
          }
          return yield* HttpServerResponse.json({ entries: rows });
        }

        if (parts[0] === "mcp" && parts[1] && request.method === "POST") {
          const sessionId = SessionId.make(parts[1]);
          const session = sessions.get(parts[1]);
          if (session === undefined) {
            return yield* HttpServerResponse.json({ error: "no such session" }, { status: 404 });
          }
          const body = yield* request.json;
          const ctx = yield* Effect.context<never>();
          const reply = yield* Effect.promise(() =>
            serveRpc(body, {
              serverName: "mcp-trust-gateway",
              listTools: async () => listTools(session),
              callTool: (name, args) =>
                Effect.runPromiseWith(ctx)(callTool(sessionId, session, name, args)),
            }),
          );
          return reply === null
            ? HttpServerResponse.empty({ status: 202 })
            : yield* HttpServerResponse.json(reply);
        }
        return HttpServerResponse.text("mcp-trust gateway", { status: 404 });
      }).pipe(Effect.orDie),
    };
  }).pipe(Effect.provide(McpTrustOnDurableObjects)),
) {}
