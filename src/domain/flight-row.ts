import * as Schema from "effect/Schema";

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

export interface LoggedEvent {
  readonly _tag: string;
  readonly [field: string]: unknown;
}

export interface RowInput {
  readonly seq: number;
  readonly at: string;
  readonly session: string;
  readonly event: LoggedEvent;
}

const BLOCKED = new Set(["TargetNotNamed", "TargetsNotDeclared"]);

const text = (event: LoggedEvent, key: string): string | null => {
  const value = event[key];
  return typeof value === "string" ? value : null;
};

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

const draftOf = (event: LoggedEvent): Draft => {
  const name = event._tag;
  switch (name) {
    case "ServerRegistered":
      return draft({
        kind: "event",
        name,
        server: text(event, "serverId"),
        provider: text(event, "provider"),
      });
    case "ToolRegistered":
      return draft({
        kind: "event",
        name,
        tool: text(event, "name"),
        server: text(event, "server"),
        provider: text(event, "provider"),
        verified: true,
      });
    case "NameCollided":
      return draft({
        kind: "event",
        name,
        tool: text(event, "tool"),
        provider: text(event, "provider"),
        verified: true,
      });
    case "CallRouted":
      return draft({
        kind: "event",
        name,
        tool: text(event, "tool"),
        server: text(event, "server"),
        provider: text(event, "provider"),
        verified: true,
      });
    case "TargetsNamed":
      return draft({ kind: "event", name });
    case "WriteAllowed":
    case "ReadAllowed":
      return draft({ kind: "event", name, tool: text(event, "tool"), verdict: "allowed" });
    case "RefusalRecorded": {
      const rejection = text(event, "rejection");
      return draft({
        kind: "rejection",
        name,
        tool: text(event, "tool"),
        server: text(event, "server"),
        provider: text(event, "provider"),
        verdict: rejection !== null && BLOCKED.has(rejection) ? "blocked" : "n/a",
        rejection,
      });
    }
    default:
      throw new Error(`no flight row for event ${name}`);
  }
};

export const rowOf = (input: RowInput): FlightEntry => ({
  seq: input.seq,
  at: input.at,
  session: input.session,
  ...draftOf(input.event),
});
