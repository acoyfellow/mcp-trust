import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { FlightKey, THE_FLIGHT } from "./ids.ts";
import { Refusals } from "./refusals.ts";
import { ToolRegistry } from "./tool-registry.ts";
import { WriteFence } from "./write-fence.ts";

export { type FlightEntry, rowOf, Verdict } from "./flight-row.ts";

export class FlightLogged extends Domain.Event("FlightLogged", {
  source: Schema.String,
  session: Schema.String,
  at: Schema.String,
  event: Schema.Any,
}) {}

const logged = (
  source: string,
  event: { readonly _tag: string },
  context: { readonly source: { readonly id: string }; readonly at: DateTime.Utc },
) =>
  new FlightLogged({
    source,
    session: context.source.id,
    at: DateTime.formatIso(context.at),
    event: JSON.parse(JSON.stringify(event)) as unknown,
  });

export class FlightLog extends Domain.View("FlightLog", {
  from: [ToolRegistry, WriteFence, Refusals],
  key: FlightKey,
  keyOf: {
    ToolRegistry: () => THE_FLIGHT,
    WriteFence: () => THE_FLIGHT,
    Refusals: () => THE_FLIGHT,
  },
  version: 1,
  events: [FlightLogged],
  emit: {
    ToolRegistry: (e, c) => logged("ToolRegistry", e, c),
    WriteFence: (e, c) => logged("WriteFence", e, c),
    Refusals: (e, c) => logged("Refusals", e, c),
  },
}) {}
