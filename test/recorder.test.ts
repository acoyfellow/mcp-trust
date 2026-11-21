import { expect, test } from "bun:test";
import { colorize, formatLine, type Recorded, sourceOf } from "../src/recorder/format.ts";
import { hashState, replay } from "../src/recorder/replay.ts";

const record = (
  seq: number,
  session: string,
  event: Recorded["event"],
  at = `2026-11-21T10:00:0${seq}.250Z`,
): Recorded => ({
  seq,
  at,
  event,
  session,
  source: sourceOf(event._tag),
  receivedAt: 0,
  wroteAt: 0,
  row: {} as Recorded["row"],
});

const recording: ReadonlyArray<Recorded> = [
  record(1, "s-1", {
    _tag: "ServerRegistered",
    serverId: "acme-1",
    provider: "acme",
    publicKey: "k",
    url: "u",
  }),
  record(2, "s-1", {
    _tag: "ToolRegistered",
    name: "execute",
    server: "acme-1",
    provider: "acme",
    schemaHash: "h",
  }),
  record(3, "s-2", { _tag: "TargetsNamed", targets: ["scratch:a"] }),
  record(4, "s-2", { _tag: "WriteAllowed", tool: "kv_put", target: "scratch:a" }),
  record(5, "s-1", {
    _tag: "RefusalRecorded",
    rejection: "ProviderNotNamed",
    tool: "execute",
    server: "lookalike-1",
    provider: "cloudflare-mcp",
    target: null,
  }),
];

test("replay folds recorded events into the FlightLog view, one row each, in order", () => {
  const state = replay(recording);
  expect(state.entries.map((e) => [e.seq, e.session, e.name])).toEqual([
    [1, "s-1", "ServerRegistered"],
    [2, "s-1", "ToolRegistered"],
    [3, "s-2", "TargetsNamed"],
    [4, "s-2", "WriteAllowed"],
    [5, "s-1", "RefusalRecorded"],
  ]);
  expect(state.entries[1]).toMatchObject({ tool: "execute", provider: "acme", verified: true });
  expect(state.entries[3]).toMatchObject({ verdict: "allowed" });
  expect(state.entries[4]).toMatchObject({ kind: "rejection", rejection: "ProviderNotNamed" });
  expect(state.entries[0]?.at).toBe("2026-11-21T10:00:01.250Z");
});

test("replay from a seed continues the numbering", () => {
  const seed = replay(recording.slice(0, 2));
  const state = replay(recording.slice(2), seed);
  expect(hashState(state)).toBe(hashState(replay(recording)));
});

test("the hash changes when a record is dropped, swapped or altered", () => {
  const whole = hashState(replay(recording));
  expect(hashState(replay([...recording.slice(0, 2), ...recording.slice(3)]))).not.toBe(whole);
  const swapped = [...recording];
  swapped[2] = recording[3] as Recorded;
  swapped[3] = recording[2] as Recorded;
  expect(hashState(replay(swapped))).not.toBe(whole);
  const altered = recording.map((r, i) =>
    i === 3 ? { ...r, event: { _tag: "WriteAllowed", tool: "kv_delete", target: "scratch:a" } } : r,
  );
  expect(hashState(replay(altered))).not.toBe(whole);
});

test("the hash does not depend on key order", () => {
  const a = { entries: [{ seq: 1, name: "x" }] } as never;
  const b = { entries: [{ name: "x", seq: 1 }] } as never;
  expect(hashState(a)).toBe(hashState(b));
});

test("formatLine prints time, session, tool, provider with its verification, fence verdict and rejection", () => {
  const rows = replay(recording).entries;
  expect(formatLine(rows[1] as never)).toBe(
    "#00002 10:00:02.250 s-1 ToolRegistered tool=execute provider=acme:verified fence=n/a reject=-",
  );
  expect(formatLine(rows[4] as never)).toBe(
    "#00005 10:00:05.250 s-1 RefusalRecorded tool=execute provider=cloudflare-mcp:unverified fence=n/a reject=ProviderNotNamed",
  );
  expect(formatLine(rows[3] as never)).toBe(
    "#00004 10:00:04.250 s-2 WriteAllowed tool=kv_put provider=- fence=allowed reject=-",
  );
});

test("sourceOf refuses an event it does not know", () => {
  expect(() => sourceOf("Unknown")).toThrow();
  expect(() => sourceOf("__proto__")).toThrow();
});

test("colorize paints refusals red and allowed or routed lines green, and nothing else", () => {
  const rows = replay(recording).entries;
  const line = (i: number) => formatLine(rows[i] as never);
  expect(colorize(rows[4] as never, line(4), true)).toBe(`\u001b[31m${line(4)}\u001b[0m`);
  expect(colorize(rows[3] as never, line(3), true)).toBe(`\u001b[32m${line(3)}\u001b[0m`);
  expect(colorize(rows[0] as never, line(0), true)).toBe(line(0));
  expect(colorize(rows[4] as never, line(4), false)).toBe(line(4));
});
