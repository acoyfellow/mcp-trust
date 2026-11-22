import { expect, test } from "bun:test";
import {
  Classifier,
  colorize,
  formatLine,
  type Recorded,
  type WireEntry,
} from "../src/recorder/format.ts";
import { sseEntries } from "../src/recorder/record.ts";
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
  source: "test",
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

test("colorize paints each tone and leaves the line alone when color is off", () => {
  expect(colorize("red", "x", true)).toBe("\u001b[31mx\u001b[0m");
  expect(colorize("green", "x", true)).toBe("\u001b[32mx\u001b[0m");
  expect(colorize("yellow", "x", true)).toBe("\u001b[33mx\u001b[0m");
  expect(colorize("dim", "x", true)).toBe("\u001b[2mx\u001b[0m");
  expect(colorize("red", "x", false)).toBe("x");
});

const wire = (
  seq: number,
  event: Recorded["event"],
  row: Partial<Recorded["row"]> = {},
): WireEntry => ({
  seq,
  at: "2026-11-21T23:17:53.100Z",
  source: "test",
  event,
  row: {
    seq,
    at: "2026-11-21T23:17:53.100Z",
    session: "s-1",
    kind: "event",
    name: event._tag,
    tool: null,
    server: null,
    provider: null,
    verified: true,
    verdict: "n/a",
    rejection: null,
    ...row,
  },
});

test("compact mode shows calls, writes and refusals and hides registration and TargetsNamed", () => {
  const c = new Classifier();
  const shown = (e: ReturnType<typeof wire>) => c.show(e);
  expect(shown(wire(1, { _tag: "ServerRegistered" })).compact).toBeNull();
  expect(shown(wire(2, { _tag: "ToolRegistered" })).compact).toBeNull();
  expect(shown(wire(3, { _tag: "TargetsNamed" })).compact).toBeNull();
  expect(shown(wire(4, { _tag: "ReadAllowed" }, { tool: "read_document" })).compact).toBeNull();
  expect(
    shown(
      wire(
        5,
        { _tag: "WriteAllowed", target: "scratch:a" },
        { tool: "kv_put", verdict: "allowed" },
      ),
    ).compact,
  ).toBe("23:17:53  kv_put scratch:a   ALLOWED");
  const blocked = shown(
    wire(
      6,
      { _tag: "RefusalRecorded", target: "decoy:x" },
      { kind: "rejection", tool: "kv_put", rejection: "TargetNotNamed", verdict: "blocked" },
    ),
  );
  expect(blocked.compact).toBe("23:17:53  kv_put decoy:x   BLOCKED TargetNotNamed");
  expect(blocked.tone).toBe("red");
  const provider = shown(
    wire(
      7,
      { _tag: "RefusalRecorded" },
      {
        kind: "rejection",
        tool: "execute",
        provider: "cloudflare-mcp",
        rejection: "ProviderNotNamed",
        verdict: "blocked",
      },
    ),
  );
  expect(provider.compact).toBe("23:17:53  cloudflare-mcp__execute   BLOCKED ProviderNotNamed");
});

test("compact lines never pass the width and a long target is cut with an ellipsis", () => {
  const c = new Classifier();
  const long = c.show(
    wire(
      1,
      { _tag: "RefusalRecorded", target: "decoy:inj/demo-mq3f9a1b2c/0/0/more/more/more" },
      { kind: "rejection", tool: "kv_put", rejection: "TargetNotNamed", verdict: "blocked" },
    ),
  ).compact as string;
  expect(long.length).toBeLessThanOrEqual(60);
  expect(long).toContain("…");
  expect(long).toContain("…ore/more");
  expect(long.endsWith("BLOCKED TargetNotNamed")).toBe(true);
});

test("an unpinned call into a same-name collision is yellow and not safe", () => {
  const c = new Classifier();
  c.show(
    wire(
      1,
      {
        _tag: "NameCollided",
        tool: "execute",
        provider: "cloudflare-mcp",
        otherProviders: ["cloudflare"],
      },
      { tool: "execute" },
    ),
  );
  const reached = c.show(
    wire(2, { _tag: "CallRouted", pinned: false }, { tool: "execute", provider: "cloudflare-mcp" }),
  );
  expect(reached.tone).toBe("yellow");
  expect(reached.compact).toBe("23:17:53  REACHED lookalike cloudflare-mcp (unpinned)");
  const trusted = c.show(
    wire(3, { _tag: "CallRouted", pinned: false }, { tool: "execute", provider: "cloudflare" }),
  );
  expect(trusted.compact).toBe("23:17:53  REACHED cloudflare (unpinned)");
  expect(trusted.tone).toBe("yellow");
});

test("a pinned call is green, and a routed call with no collision stays out of compact mode", () => {
  const c = new Classifier();
  const quiet = c.show(
    wire(1, { _tag: "CallRouted", pinned: false }, { tool: "kv_put", provider: "acme" }),
  );
  expect(quiet.tone).toBe("green");
  expect(quiet.compact).toBeNull();
  c.show(
    wire(
      2,
      {
        _tag: "NameCollided",
        tool: "execute",
        provider: "cloudflare-mcp",
        otherProviders: ["cloudflare"],
      },
      { tool: "execute" },
    ),
  );
  const pinned = c.show(
    wire(3, { _tag: "CallRouted", pinned: true }, { tool: "execute", provider: "cloudflare" }),
  );
  expect(pinned.tone).toBe("green");
  expect(pinned.compact).toBe("23:17:53  cloudflare__execute   ROUTED");
});

test("a collision in one session does not mark calls in another session", () => {
  const c = new Classifier();
  c.show(
    wire(
      1,
      {
        _tag: "NameCollided",
        tool: "execute",
        provider: "cloudflare-mcp",
        otherProviders: ["cloudflare"],
      },
      { tool: "execute" },
    ),
  );
  const other = c.show(
    wire(
      2,
      { _tag: "CallRouted", pinned: false },
      { session: "s-2", tool: "execute", provider: "cloudflare-mcp" },
    ),
  );
  expect(other.tone).toBe("green");
});

test("sseEntries parses frames split across chunks and skips heartbeats", async () => {
  const encoder = new TextEncoder();
  const first = wire(1, { _tag: "TargetsNamed" });
  const second = wire(2, { _tag: "ReadAllowed" }, { tool: "read_document" });
  const text = `: ping\n\nid: 1\ndata: ${JSON.stringify(first)}\n\nid: 2\ndata: ${JSON.stringify(second)}\n\n`;
  const cut = 37;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text.slice(0, cut)));
      controller.enqueue(encoder.encode(text.slice(cut, cut + 50)));
      controller.enqueue(encoder.encode(text.slice(cut + 50)));
      controller.close();
    },
  });
  const seen: number[] = [];
  for await (const entry of sseEntries(body)) seen.push(entry.seq);
  expect(seen).toEqual([1, 2]);
});
