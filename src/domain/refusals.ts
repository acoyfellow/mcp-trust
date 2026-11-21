import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { SessionId } from "./ids.ts";

export const RejectionName = Schema.Literals([
  "ServerAlreadyRegistered",
  "UnverifiedPassport",
  "AmbiguousTool",
  "Misbinding",
  "ProviderNotNamed",
  "TargetNotNamed",
  "TargetsNotDeclared",
]);

export class RefusalRecorded extends Domain.Event("RefusalRecorded", {
  rejection: RejectionName,
  tool: Schema.NullOr(Schema.String),
  server: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  target: Schema.NullOr(Schema.String),
}) {}

export class RecordRefusal extends Domain.Command("RecordRefusal", {
  target: SessionId,
  input: {
    rejection: RejectionName,
    tool: Schema.NullOr(Schema.String),
    server: Schema.NullOr(Schema.String),
    provider: Schema.NullOr(Schema.String),
    target: Schema.NullOr(Schema.String),
  },
  events: [RefusalRecorded],
}) {}

export class Refusals extends Domain.Aggregate("Refusals", {
  id: SessionId,
  state: Schema.Struct({ count: Schema.Int }),
  initial: { count: 0 },
  commands: [RecordRefusal],
  decide: {
    RecordRefusal: (_, cmd) => [
      new RefusalRecorded({
        rejection: cmd.rejection,
        tool: cmd.tool,
        server: cmd.server,
        provider: cmd.provider,
        target: cmd.target,
      }),
    ],
  },
  evolve: {
    RefusalRecorded: (s) => ({ count: s.count + 1 }),
  },
}) {}
