import * as Schema from "effect/Schema";

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

export const FlightKey = Schema.String.pipe(Schema.brand("FlightKey"));
export type FlightKey = typeof FlightKey.Type;

export const THE_FLIGHT = FlightKey.make("all");
