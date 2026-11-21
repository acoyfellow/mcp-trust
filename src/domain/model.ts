import * as Domain from "@alchemy.run/domain";
import { FlightLog } from "./flight-log.ts";
import { Refusals } from "./refusals.ts";
import { ToolRegistry } from "./tool-registry.ts";
import { WriteFence } from "./write-fence.ts";

export class McpTrust extends Domain.Model("McpTrust", {
  aggregates: [ToolRegistry, WriteFence, Refusals],
  views: [FlightLog],
}) {}
