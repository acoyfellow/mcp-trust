import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { SessionId } from "./ids.ts";
import { verifyPassport } from "./passport.ts";

export class ServerRegistered extends Domain.Event("ServerRegistered", {
  serverId: Schema.String,
  provider: Schema.String,
  publicKey: Schema.String,
  url: Schema.String,
}) {}

export class ToolRegistered extends Domain.Event("ToolRegistered", {
  name: Schema.String,
  server: Schema.String,
  provider: Schema.String,
  schemaHash: Schema.String,
}) {}

export class CallRouted extends Domain.Event("CallRouted", {
  tool: Schema.String,
  server: Schema.String,
  provider: Schema.String,
  pinned: Schema.optionalKey(Schema.Boolean),
}) {}

export class NameCollided extends Domain.Event("NameCollided", {
  tool: Schema.String,
  provider: Schema.String,
  otherProviders: Schema.Array(Schema.String),
}) {}

export class ServerAlreadyRegistered extends Domain.Rejection("ServerAlreadyRegistered", {
  serverId: Schema.String,
}) {}

export class UnverifiedPassport extends Domain.Rejection("UnverifiedPassport", {
  tool: Schema.String,
  server: Schema.String,
}) {}

export class AmbiguousTool extends Domain.Rejection("AmbiguousTool", {
  tool: Schema.String,
  providers: Schema.Array(Schema.String),
}) {}

export class ProviderNotNamed extends Domain.Rejection("ProviderNotNamed", {
  tool: Schema.String,
  provider: Schema.String,
  named: Schema.Array(Schema.String),
}) {}

export class Misbinding extends Domain.Rejection("Misbinding", {
  tool: Schema.String,
  requestedServer: Schema.String,
  requestedProvider: Schema.NullOr(Schema.String),
  boundTo: Schema.NullOr(Schema.String),
}) {}

export class RegisterServer extends Domain.Command("RegisterServer", {
  target: SessionId,
  input: {
    serverId: Schema.String,
    provider: Schema.String,
    publicKey: Schema.String,
    url: Schema.String,
  },
  events: [ServerRegistered],
  rejects: [ServerAlreadyRegistered],
}) {}

export class RegisterTool extends Domain.Command("RegisterTool", {
  target: SessionId,
  input: {
    name: Schema.String,
    server: Schema.String,
    schemaHash: Schema.String,
    signature: Schema.String,
  },
  events: [ToolRegistered, NameCollided],
  rejects: [UnverifiedPassport],
}) {}

export class RouteCall extends Domain.Command("RouteCall", {
  target: SessionId,
  input: {
    tool: Schema.String,
    server: Schema.String,
    provider: Schema.NullOr(Schema.String),
    named: Schema.NullOr(Schema.Array(Schema.String)),
  },
  events: [CallRouted],
  rejects: [Misbinding, AmbiguousTool, ProviderNotNamed],
}) {}

const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const Server = Schema.Struct({
  provider: Schema.String,
  publicKey: Schema.String,
  url: Schema.String,
});

const Tool = Schema.Struct({ server: Schema.String, schemaHash: Schema.String });

const State = Schema.Struct({
  servers: Schema.Record(Schema.String, Server),
  tools: Schema.Record(Schema.String, Schema.Record(Schema.String, Tool)),
});

export class ToolRegistry extends Domain.Aggregate("ToolRegistry", {
  id: SessionId,
  state: State,
  initial: { servers: {}, tools: {} },
  commands: [RegisterServer, RegisterTool, RouteCall],
  decide: {
    RegisterServer: (registry, cmd) =>
      Object.hasOwn(registry.servers, cmd.serverId)
        ? new ServerAlreadyRegistered({ serverId: cmd.serverId })
        : [
            new ServerRegistered({
              serverId: cmd.serverId,
              provider: cmd.provider,
              publicKey: cmd.publicKey,
              url: cmd.url,
            }),
          ],
    RegisterTool: (registry, cmd) => {
      const server = Object.hasOwn(registry.servers, cmd.server)
        ? registry.servers[cmd.server]
        : undefined;
      if (
        server === undefined ||
        !verifyPassport(server.publicKey, cmd.signature, {
          provider: server.provider,
          serverUrl: server.url,
          toolName: cmd.name,
          schemaHash: cmd.schemaHash,
        })
      ) {
        return new UnverifiedPassport({ tool: cmd.name, server: cmd.server });
      }
      const byProvider = own(registry.tools, cmd.name) ?? {};
      const others = Object.keys(byProvider)
        .filter((provider) => provider !== server.provider)
        .sort();
      return [
        new ToolRegistered({
          name: cmd.name,
          server: cmd.server,
          provider: server.provider,
          schemaHash: cmd.schemaHash,
        }),
        ...(others.length > 0
          ? [
              new NameCollided({
                tool: cmd.name,
                provider: server.provider,
                otherProviders: others,
              }),
            ]
          : []),
      ];
    },
    RouteCall: (registry, cmd) => {
      const byProvider = own(registry.tools, cmd.tool) ?? {};
      const providers = Object.keys(byProvider).sort();
      const misbinding = (boundTo: string | null) =>
        new Misbinding({
          tool: cmd.tool,
          requestedServer: cmd.server,
          requestedProvider: cmd.provider,
          boundTo,
        });
      const routed = (provider: string) =>
        cmd.named !== null && !cmd.named.includes(provider)
          ? new ProviderNotNamed({ tool: cmd.tool, provider, named: cmd.named })
          : [
              new CallRouted({
                tool: cmd.tool,
                server: cmd.server,
                provider,
                pinned: cmd.named !== null,
              }),
            ];
      if (cmd.provider === null) {
        if (providers.length > 1) return new AmbiguousTool({ tool: cmd.tool, providers });
        const only = providers[0];
        if (only === undefined) return misbinding(null);
        const tool = byProvider[only];
        if (tool === undefined || tool.server !== cmd.server)
          return misbinding(tool?.server ?? null);
        return routed(only);
      }
      const bound = own(byProvider, cmd.provider);
      if (bound === undefined || bound.server !== cmd.server) {
        return misbinding(bound === undefined ? null : bound.server);
      }
      return routed(cmd.provider);
    },
  },
  evolve: {
    ServerRegistered: (s, e) => ({
      ...s,
      servers: {
        ...s.servers,
        [e.serverId]: { provider: e.provider, publicKey: e.publicKey, url: e.url },
      },
    }),
    ToolRegistered: (s, e) => ({
      ...s,
      tools: {
        ...s.tools,
        [e.name]: {
          ...(own(s.tools, e.name) ?? {}),
          [e.provider]: { server: e.server, schemaHash: e.schemaHash },
        },
      },
    }),
    NameCollided: (s) => s,
    CallRouted: (s) => s,
  },
}) {}
