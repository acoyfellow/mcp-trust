import { expect, test } from "bun:test";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FlightLog } from "../../src/domain/flight-log.ts";
import { THE_FLIGHT } from "../../src/domain/ids.ts";
import { McpTrust } from "../../src/domain/model.ts";
import {
  RegisterServer,
  RegisterTool,
  RouteCall,
  ToolRegistry,
} from "../../src/domain/tool-registry.ts";
import { NameTargets, RequestWrite, WriteFence } from "../../src/domain/write-fence.ts";
import { ACME_URL, acme, acmePassport, SCHEMA, s1 } from "./fixtures.ts";

test("the model is well defined", () => {
  expect(Domain.verify(McpTrust)).toEqual([]);
});

const Host = McpTrust.layer(Layer.empty).pipe(Layer.provide(Domain.InMemory));

test("hosted in memory, commands reach the flight log and rejections reach the caller", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* ToolRegistry;
      const fence = yield* WriteFence;
      const log = yield* FlightLog;

      yield* registry.send(
        s1,
        new RegisterServer({
          serverId: "acme-1",
          provider: "acme",
          publicKey: acme.publicKey,
          url: ACME_URL,
        }),
      );
      yield* registry.send(
        s1,
        new RegisterTool({
          name: "execute",
          server: "acme-1",
          schemaHash: SCHEMA,
          signature: acmePassport("execute"),
        }),
      );
      const routed = yield* registry.send(s1, new RouteCall({ tool: "execute", server: "acme-1" }));
      yield* fence.send(s1, new NameTargets({ targets: ["scratch:a"] }));
      const refused = yield* fence
        .send(s1, new RequestWrite({ tool: "kv_put", target: "decoy:a" }))
        .pipe(Effect.flip);
      expect(refused._tag).toBe("TargetNotNamed");

      const state = yield* log.get(THE_FLIGHT, {
        atLeast: { stream: routed.stream, version: routed.version },
      });
      expect(Option.isSome(state)).toBe(true);
      const names = Option.getOrThrow(state).entries.map((e) => e.name);
      expect(names).toContain("CallRouted");
      expect(names).toContain("ToolRegistered");
    }).pipe(Effect.scoped, Effect.provide(Host)),
  ));
