import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { FlightKey, THE_FLIGHT } from "./ids.ts";
import { Refusals } from "./refusals.ts";
import { ToolRegistry } from "./tool-registry.ts";
import { WriteFence } from "./write-fence.ts";

export const Verdict = Schema.Literals(["n/a", "allowed", "blocked"]);

export const FlightEntry = Schema.Struct({
  seq: Schema.Int,
  at: Schema.String,
  session: Schema.String,
  kind: Schema.Literals(["event", "rejection"]),
  name: Schema.String,
  tool: Schema.NullOr(Schema.String),
  server: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  verified: Schema.Boolean,
  verdict: Verdict,
  rejection: Schema.NullOr(Schema.String),
});
export type FlightEntry = typeof FlightEntry.Type;

const State = Schema.Struct({ entries: Schema.Array(FlightEntry) });
type State = typeof State.Type;

type Draft = Omit<FlightEntry, "seq" | "at" | "session">;

const draft = (fields: Partial<Draft> & Pick<Draft, "kind" | "name">): Draft => ({
  tool: null,
  server: null,
  provider: null,
  verified: false,
  verdict: "n/a",
  rejection: null,
  ...fields,
});

const append = (
  state: State,
  context: { readonly source: { readonly id: string }; readonly at: DateTime.Utc },
  entry: Draft,
): State => ({
  entries: [
    ...state.entries,
    {
      seq: state.entries.length + 1,
      at: DateTime.formatIso(context.at),
      session: context.source.id,
      ...entry,
    },
  ],
});

const BLOCKED = new Set(["TargetNotNamed", "TargetsNotDeclared"]);

export class FlightLog extends Domain.View("FlightLog", {
  from: [ToolRegistry, WriteFence, Refusals],
  key: FlightKey,
  state: State,
  initial: { entries: [] },
  keyOf: {
    ToolRegistry: () => THE_FLIGHT,
    WriteFence: () => THE_FLIGHT,
    Refusals: () => THE_FLIGHT,
  },
  evolve: {
    ServerRegistered: (s, e, c) =>
      append(
        s,
        c,
        draft({ kind: "event", name: e._tag, server: e.serverId, provider: e.provider }),
      ),
    ToolRegistered: (s, e, c) =>
      append(
        s,
        c,
        draft({
          kind: "event",
          name: e._tag,
          tool: e.name,
          server: e.server,
          provider: e.provider,
          verified: true,
        }),
      ),
    NameCollided: (s, e, c) =>
      append(
        s,
        c,
        draft({ kind: "event", name: e._tag, tool: e.tool, provider: e.provider, verified: true }),
      ),
    CallRouted: (s, e, c) =>
      append(
        s,
        c,
        draft({
          kind: "event",
          name: e._tag,
          tool: e.tool,
          server: e.server,
          provider: e.provider,
          verified: true,
        }),
      ),
    TargetsNamed: (s, e, c) => append(s, c, draft({ kind: "event", name: e._tag })),
    WriteAllowed: (s, e, c) =>
      append(s, c, draft({ kind: "event", name: e._tag, tool: e.tool, verdict: "allowed" })),
    ReadAllowed: (s, e, c) =>
      append(s, c, draft({ kind: "event", name: e._tag, tool: e.tool, verdict: "allowed" })),
    RefusalRecorded: (s, e, c) =>
      append(
        s,
        c,
        draft({
          kind: "rejection",
          name: e._tag,
          tool: e.tool,
          server: e.server,
          provider: e.provider,
          verdict: BLOCKED.has(e.rejection) ? "blocked" : "n/a",
          rejection: e.rejection,
        }),
      ),
  },
}) {}
