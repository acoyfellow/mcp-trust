import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { SessionId } from "./ids.ts";

export class TargetsNamed extends Domain.Event("TargetsNamed", {
  targets: Schema.Array(Schema.String),
}) {}

export class WriteAllowed extends Domain.Event("WriteAllowed", {
  tool: Schema.String,
  target: Schema.String,
}) {}

export class TargetNotNamed extends Domain.Rejection("TargetNotNamed", {
  tool: Schema.String,
  target: Schema.String,
}) {}

export class TargetsNotDeclared extends Domain.Rejection("TargetsNotDeclared", {
  tool: Schema.String,
  target: Schema.String,
}) {}

export class NameTargets extends Domain.Command("NameTargets", {
  target: SessionId,
  input: { targets: Schema.Array(Schema.String) },
  events: [TargetsNamed],
}) {}

export class RequestWrite extends Domain.Command("RequestWrite", {
  target: SessionId,
  input: { tool: Schema.String, target: Schema.String },
  events: [WriteAllowed],
  rejects: [TargetNotNamed, TargetsNotDeclared],
}) {}

const State = Schema.Union([
  Schema.TaggedStruct("Undeclared", {}),
  Schema.TaggedStruct("Declared", { targets: Schema.Array(Schema.String) }),
]);

export class WriteFence extends Domain.Aggregate("WriteFence", {
  id: SessionId,
  state: State,
  initial: { _tag: "Undeclared" },
  commands: [NameTargets, RequestWrite],
  decide: {
    NameTargets: (_, cmd) => [new TargetsNamed({ targets: cmd.targets })],
    RequestWrite: (fence, cmd) => {
      if (fence._tag === "Undeclared") {
        return new TargetsNotDeclared({ tool: cmd.tool, target: cmd.target });
      }
      return fence.targets.includes(cmd.target)
        ? [new WriteAllowed({ tool: cmd.tool, target: cmd.target })]
        : new TargetNotNamed({ tool: cmd.tool, target: cmd.target });
    },
  },
  evolve: {
    TargetsNamed: (s, e) => ({
      _tag: "Declared" as const,
      targets: [...new Set([...(s._tag === "Declared" ? s.targets : []), ...e.targets])],
    }),
    WriteAllowed: (s) => s,
  },
}) {}
