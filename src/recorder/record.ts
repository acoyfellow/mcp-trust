import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BANNER, Classifier, colorize, type Recorded, sourceOf, type WireEntry } from "./format.ts";

export interface RecordOptions {
  readonly gateway: string;
  readonly out: string;
  readonly after: number;
  readonly compact?: boolean | undefined;
}

export const record = async (options: RecordOptions): Promise<never> => {
  const out = resolve(options.out);
  mkdirSync(dirname(out), { recursive: true });
  console.log(`${BANNER} ${options.gateway} after=${options.after}`);
  const color = process.stdout.isTTY === true || process.env.MCP_TRUST_COLOR === "1";
  const classifier = new Classifier();
  let cursor = options.after;
  for (;;) {
    let entries: ReadonlyArray<WireEntry>;
    try {
      const response = await fetch(
        `${options.gateway}/admin/flight/events?after=${cursor}&wait=20000`,
      );
      if (!response.ok) throw new Error(`gateway answered ${response.status}`);
      entries = ((await response.json()) as { entries: ReadonlyArray<WireEntry> }).entries;
    } catch (error) {
      console.log(`mcp-trust waiting for the gateway: ${String(error).slice(0, 80)}`);
      await Bun.sleep(500);
      continue;
    }
    const receivedAt = Date.now();
    for (const entry of entries) {
      const shown = classifier.show(entry);
      const line = options.compact === true ? shown.compact : shown.full;
      if (line !== null) process.stdout.write(`${colorize(shown.tone, line, color)}\n`);
      const recorded: Recorded = {
        ...entry,
        session: entry.row.session,
        source: sourceOf(entry.event._tag),
        receivedAt,
        wroteAt: Date.now(),
      };
      appendFileSync(out, `${JSON.stringify(recorded)}\n`);
      cursor = entry.seq;
    }
  }
};
