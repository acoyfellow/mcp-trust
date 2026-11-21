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
}) {}

export class ServerAlreadyRegistered extends Domain.Rejection("ServerAlreadyRegistered", {
  serverId: Schema.String,
}) {}

export class UnverifiedPassport extends Domain.Rejection("UnverifiedPassport", {
  tool: Schema.String,
  server: Schema.String,
}) {}

export class NameCollision extends Domain.Rejection("NameCollision", {
  tool: Schema.String,
  boundTo: Schema.String,
  attemptedBy: Schema.String,
}) {}

export class Misbinding extends Domain.Rejection("Misbinding", {
  tool: Schema.String,
  requestedServer: Schema.String,
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
  events: [ToolRegistered],
  rejects: [UnverifiedPassport, NameCollision],
}) {}

export class RouteCall extends Domain.Command("RouteCall", {
  target: SessionId,
  input: { tool: Schema.String, server: Schema.String },
  events: [CallRouted],
  rejects: [Misbinding],
}) {}

const Server = Schema.Struct({
  provider: Schema.String,
  publicKey: Schema.String,
  url: Schema.String,
});

const Tool = Schema.Struct({ server: Schema.String, schemaHash: Schema.String });

const State = Schema.Struct({
  servers: Schema.Record(Schema.String, Server),
  tools: Schema.Record(Schema.String, Tool),
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
      const bound = Object.hasOwn(registry.tools, cmd.name) ? registry.tools[cmd.name] : undefined;
      if (bound !== undefined && bound.server !== cmd.server) {
        return new NameCollision({
          tool: cmd.name,
          boundTo: bound.server,
          attemptedBy: cmd.server,
        });
      }
      return [
        new ToolRegistered({
          name: cmd.name,
          server: cmd.server,
          provider: server.provider,
          schemaHash: cmd.schemaHash,
        }),
      ];
    },
    RouteCall: (registry, cmd) => {
      const bound = Object.hasOwn(registry.tools, cmd.tool) ? registry.tools[cmd.tool] : undefined;
      if (bound === undefined || bound.server !== cmd.server) {
        return new Misbinding({
          tool: cmd.tool,
          requestedServer: cmd.server,
          boundTo: bound === undefined ? null : bound.server,
        });
      }
      return [
        new CallRouted({
          tool: cmd.tool,
          server: cmd.server,
          provider: registry.servers[bound.server]?.provider ?? "",
        }),
      ];
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
      tools: { ...s.tools, [e.name]: { server: e.server, schemaHash: e.schemaHash } },
    }),
    CallRouted: (s) => s,
  },
}) {}
