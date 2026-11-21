#!/usr/bin/env bun
import { closePane, startPane } from "../src/recorder/pane.ts";
import { record } from "../src/recorder/record.ts";
import { hashState, readRecords, replay } from "../src/recorder/replay.ts";

const USAGE = `mcp-trust: watch the flight log of an MCP gateway.

Usage:
  mcp-trust watch  --gateway URL [--out FILE] [--compact]   open a Rex pane that records and prints one line per event
  mcp-trust record --gateway URL [--out FILE] [--after N] [--compact]   record and print in this terminal
  mcp-trust replay FILE                         rebuild the FlightLog view from a recording and print its hash
  mcp-trust close  BLOCK                        close a pane that watch opened
`;

const flag = (args: ReadonlyArray<string>, name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const has = (args: ReadonlyArray<string>, name: string) => args.includes(`--${name}`);

const main = async (argv: ReadonlyArray<string>) => {
  const [command, ...rest] = argv;
  if (command === "watch") {
    const gateway = flag(rest, "gateway");
    if (!gateway) throw new Error("--gateway URL is required");
    const pane = await startPane({
      gateway,
      out: flag(rest, "out"),
      compact: has(rest, "compact"),
    });
    console.log(`pane ${pane.blockId}`);
    console.log(`recording to ${pane.out}`);
    console.log(`close it with: mcp-trust close ${pane.blockId}`);
    return;
  }
  if (command === "record") {
    const gateway = flag(rest, "gateway");
    if (!gateway) throw new Error("--gateway URL is required");
    await record({
      gateway,
      out: flag(rest, "out") ?? "flight.jsonl",
      after: Number(flag(rest, "after") ?? 0),
      compact: has(rest, "compact"),
    });
    return;
  }
  if (command === "replay") {
    const file = rest[0];
    if (!file) throw new Error("replay needs a FILE");
    const state = replay(readRecords(file));
    console.log(JSON.stringify({ entries: state.entries.length, hash: hashState(state) }));
    return;
  }
  if (command === "close") {
    const block = rest[0];
    if (!block) throw new Error("close needs a BLOCK");
    await closePane(block);
    return;
  }
  console.log(USAGE);
  process.exitCode = command === undefined || command === "help" ? 0 : 1;
};

await main(process.argv.slice(2));
