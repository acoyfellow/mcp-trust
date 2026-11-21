import { expect, test } from "bun:test";
import { Story } from "@alchemy.run/domain/Story";
import { FlightLog } from "../../src/domain/flight-log.ts";
import { THE_FLIGHT } from "../../src/domain/ids.ts";
import { RecordRefusal, RefusalRecorded } from "../../src/domain/refusals.ts";
import {
  CallRouted,
  NameCollided,
  RegisterServer,
  RouteCall,
  ServerRegistered,
  ToolRegistered,
} from "../../src/domain/tool-registry.ts";
import { RequestWrite, TargetsNamed, WriteAllowed } from "../../src/domain/write-fence.ts";
import {
  ACME_URL,
  acme,
  fence,
  refusals,
  registry,
  run,
  SCHEMA,
  s1,
  s2,
  story,
} from "./fixtures.ts";

const acmeServer = new ServerRegistered({
  serverId: "acme-1",
  provider: "acme",
  publicKey: acme.publicKey,
  url: ACME_URL,
});
const acmeExecute = new ToolRegistered({
  name: "execute",
  server: "acme-1",
  provider: "acme",
  schemaHash: SCHEMA,
});

test("the log holds every event across sessions, one entry each, numbered in order", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute),
      Story.given(fence(s2), new TargetsNamed({ targets: ["scratch:a"] })),
      Story.when(
        registry(),
        new RouteCall({ tool: "execute", server: "acme-1", provider: "acme" }),
      ),
      Story.then(
        registry(),
        new CallRouted({ tool: "execute", server: "acme-1", provider: "acme" }),
      ),
      Story.when(fence(s2), new RequestWrite({ tool: "kv_put", target: "scratch:a" })),
      Story.then(fence(s2), new WriteAllowed({ tool: "kv_put", target: "scratch:a" })),
      Story.view(FlightLog, THE_FLIGHT, (state) => {
        expect(state.entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
        expect(state.entries.map((e) => e.name).sort()).toEqual(
          [
            "CallRouted",
            "ServerRegistered",
            "TargetsNamed",
            "ToolRegistered",
            "WriteAllowed",
          ].sort(),
        );
        expect(new Set(state.entries.map((e) => e.session))).toEqual(new Set([s1, s2]));
      }),
    ),
  ));

test("a routed call is logged with its provider marked verified", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute),
      Story.when(
        registry(),
        new RouteCall({ tool: "execute", server: "acme-1", provider: "acme" }),
      ),
      Story.then(
        registry(),
        new CallRouted({ tool: "execute", server: "acme-1", provider: "acme" }),
      ),
      Story.view(FlightLog, THE_FLIGHT, (state) => {
        const routed = state.entries.find((e) => e.name === "CallRouted");
        expect(routed).toMatchObject({
          kind: "event",
          session: s1,
          tool: "execute",
          server: "acme-1",
          provider: "acme",
          verified: true,
          verdict: "n/a",
          rejection: null,
        });
      }),
    ),
  ));

test("a server registration is logged with its provider marked unverified", () =>
  run(
    story(
      Story.when(
        registry(),
        new RegisterServer({
          serverId: "acme-1",
          provider: "acme",
          publicKey: acme.publicKey,
          url: ACME_URL,
        }),
      ),
      Story.then(registry(), acmeServer),
      Story.view(FlightLog, THE_FLIGHT, (state) => {
        expect(state.entries[0]).toMatchObject({
          name: "ServerRegistered",
          provider: "acme",
          verified: false,
        });
      }),
    ),
  ));

test("an allowed write is logged with the allowed verdict", () =>
  run(
    story(
      Story.given(fence(), new TargetsNamed({ targets: ["scratch:a"] })),
      Story.when(fence(), new RequestWrite({ tool: "kv_put", target: "scratch:a" })),
      Story.then(fence(), new WriteAllowed({ tool: "kv_put", target: "scratch:a" })),
      Story.view(FlightLog, THE_FLIGHT, (state) => {
        const allowed = state.entries.find((e) => e.name === "WriteAllowed");
        expect(allowed).toMatchObject({ tool: "kv_put", verdict: "allowed", rejection: null });
      }),
    ),
  ));

test("a recorded refusal is logged as a rejection with its name", () =>
  run(
    story(
      Story.when(
        refusals(),
        new RecordRefusal({
          rejection: "AmbiguousTool",
          tool: "execute",
          server: "mallory-1",
          provider: "mallory",
          target: null,
        }),
      ),
      Story.then(
        refusals(),
        new RefusalRecorded({
          rejection: "AmbiguousTool",
          tool: "execute",
          server: "mallory-1",
          provider: "mallory",
          target: null,
        }),
      ),
      Story.view(FlightLog, THE_FLIGHT, (state) => {
        expect(state.entries).toHaveLength(1);
        expect(state.entries[0]).toMatchObject({
          kind: "rejection",
          name: "RefusalRecorded",
          rejection: "AmbiguousTool",
          tool: "execute",
          server: "mallory-1",
          provider: "mallory",
          verified: false,
          verdict: "n/a",
        });
      }),
    ),
  ));

test("a fence refusal is logged with the blocked verdict", () =>
  run(
    story(
      Story.when(
        refusals(),
        new RecordRefusal({
          rejection: "TargetNotNamed",
          tool: "kv_put",
          server: null,
          provider: null,
          target: "decoy:a",
        }),
      ),
      Story.then(
        refusals(),
        new RefusalRecorded({
          rejection: "TargetNotNamed",
          tool: "kv_put",
          server: null,
          provider: null,
          target: "decoy:a",
        }),
      ),
      Story.view(FlightLog, THE_FLIGHT, (state) => {
        expect(state.entries[0]).toMatchObject({
          rejection: "TargetNotNamed",
          verdict: "blocked",
        });
      }),
    ),
  ));

test("the same events always fold to the same log", async () => {
  const states: Array<unknown> = [];
  const steps = () => [
    Story.given(registry(), acmeServer, acmeExecute),
    Story.given(fence(s2), new TargetsNamed({ targets: ["scratch:a"] })),
    Story.view(FlightLog, THE_FLIGHT, (state) => {
      states.push(state.entries.map(({ at, ...rest }) => rest));
    }),
  ];
  await run(story(...steps()));
  await run(story(...steps()));
  expect(states).toHaveLength(2);
  expect(states[0]).toEqual(states[1]);
});

test("a name collision is logged as an event, not a rejection", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute),
      Story.given(
        registry(),
        new ServerRegistered({
          serverId: "mallory-1",
          provider: "mallory",
          publicKey: "00",
          url: "https://mallory.example/mcp",
        }),
      ),
      Story.given(
        registry(),
        new ToolRegistered({
          name: "execute",
          server: "mallory-1",
          provider: "mallory",
          schemaHash: SCHEMA,
        }),
        new NameCollided({ tool: "execute", provider: "mallory", otherProviders: ["acme"] }),
      ),
      Story.view(FlightLog, THE_FLIGHT, (state) => {
        const collided = state.entries.find((e) => e.name === "NameCollided");
        expect(collided).toMatchObject({
          kind: "event",
          tool: "execute",
          provider: "mallory",
          rejection: null,
        });
      }),
    ),
  ));
