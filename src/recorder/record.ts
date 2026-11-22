import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BANNER, Classifier, colorize, type Recorded, type WireEntry } from "./format.ts";

export interface RecordOptions {
  readonly gateway: string;
  readonly out: string;
  readonly after: number;
  readonly compact?: boolean | undefined;
  readonly headers?: () => Promise<Readonly<Record<string, string>>>;
}

export async function* sseEntries(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<WireEntry, void> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(chunk, { stream: true });
    for (let end = pending.indexOf("\n\n"); end >= 0; end = pending.indexOf("\n\n")) {
      const block = pending.slice(0, end);
      pending = pending.slice(end + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (data !== "") yield JSON.parse(data) as WireEntry;
    }
  }
}

export const record = async (options: RecordOptions): Promise<never> => {
  const out = resolve(options.out);
  mkdirSync(dirname(out), { recursive: true });
  console.log(`${BANNER} ${options.gateway} after=${options.after}`);
  const color = process.stdout.isTTY === true || process.env.MCP_TRUST_COLOR === "1";
  const classifier = new Classifier();
  let cursor = options.after;
  for (;;) {
    try {
      const response = await fetch(`${options.gateway}/admin/flight/stream?after=${cursor}`, {
        headers: { accept: "text/event-stream", ...(await options.headers?.()) },
      });
      if (!response.ok || response.body === null)
        throw new Error(`gateway answered ${response.status}`);
      for await (const entry of sseEntries(response.body)) {
        if (entry.seq <= cursor) continue;
        const receivedAt = Date.now();
        const shown = classifier.show(entry);
        const line = options.compact === true ? shown.compact : shown.full;
        if (line !== null) process.stdout.write(`${colorize(shown.tone, line, color)}\n`);
        const recorded: Recorded = {
          ...entry,
          session: entry.row.session,
          receivedAt,
          wroteAt: Date.now(),
        };
        appendFileSync(out, `${JSON.stringify(recorded)}\n`);
        cursor = entry.seq;
      }
      throw new Error("the stream ended");
    } catch (error) {
      console.log(`mcp-trust waiting for the gateway: ${String(error).slice(0, 80)}`);
      await Bun.sleep(500);
    }
  }
};
