import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as DateTime from "effect/DateTime";
import { FlightLog } from "../domain/flight-log.ts";
import type { FlightRow, Recorded } from "./format.ts";

export interface LogState {
  readonly entries: ReadonlyArray<FlightRow>;
}

export const readRecords = (file: string): ReadonlyArray<Recorded> =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Recorded);

export const replay = (
  records: ReadonlyArray<Recorded>,
  seed: LogState = { entries: [] },
): LogState =>
  records.reduce(
    (state, record) =>
      FlightLog.evolve(state, {
        name: record.source,
        event: record.event,
        source: { id: record.session },
        envelope: { at: DateTime.makeUnsafe(record.at) },
      } as never) as LogState,
    seed,
  );

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const hashState = (state: LogState): string =>
  createHash("sha256").update(canonical(state)).digest("hex");
