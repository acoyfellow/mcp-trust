import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { FlightRow } from "../../src/recorder/format.ts";
import { closePane, paneCapture, startPane } from "../../src/recorder/pane.ts";
import { hashState, readRecords, replay } from "../../src/recorder/replay.ts";
import {
  gitInfo,
  kvGet,
  mulberry32,
  percentile,
  pool,
  type Receipt,
  writeReceipt,
} from "../lib/common.ts";
import { repoRoot, withStack } from "../lib/stack.ts";
import { driveSession, seqsIn, sleep } from "./lib.ts";

const SESSIONS = Number(process.env.E3_SESSIONS ?? 20);
const OFFICIAL = SESSIONS === 20;
const CONCURRENCY = 4;
const SEED = 20261123;
const RUN = `e3-${Date.now().toString(36)}`;

const main = async () => {
  const startedAt = new Date().toISOString();
  await withStack(async (urls) => {
    const head = (await (await fetch(`${urls.gatewayUrl}/admin/flight/head`)).json()) as {
      cursor: number;
      entries: FlightRow[];
    };
    mkdirSync(`${repoRoot}/.dev`, { recursive: true });
    const out = `${repoRoot}/.dev/${RUN}.jsonl`;
    rmSync(out, { force: true });
    const pane = await startPane({ gateway: urls.gatewayUrl, out, after: head.cursor });
    const seen = new Map<number, { started: number; ended: number }>();
    const captureMs: number[] = [];
    let polling = true;
    let lastText = "";
    const poller = (async () => {
      while (polling) {
        const started = Date.now();
        const text = await paneCapture(pane.blockId);
        const ended = Date.now();
        captureMs.push(ended - started);
        lastText = text;
        for (const seq of seqsIn(text)) {
          if (!seen.has(seq)) seen.set(seq, { started, ended });
        }
        await sleep(10);
      }
    })();
    try {
      for (let waited = 0; !/mcp-trust recording/.test(lastText); waited += 100) {
        if (waited > 20_000) throw new Error("the pane never showed the recording banner");
        await sleep(100);
      }
      const rng = mulberry32(SEED);
      const trafficStarted = Date.now();
      await pool(
        CONCURRENCY,
        Array.from({ length: SESSIONS }, (_, i) => i),
        (i) => driveSession(urls, RUN, i, rng),
      );
      const trafficMs = Date.now() - trafficStarted;

      const live = (await (await fetch(`${urls.gatewayUrl}/admin/flight`)).json()) as {
        entries: FlightRow[];
      };
      const newRows = live.entries.slice(head.entries.length);
      for (let waited = 0; waited < 20_000; waited += 100) {
        if (newRows.every((r) => seen.has(r.seq))) break;
        await sleep(100);
      }
      polling = false;
      await poller;
      const finalText = await paneCapture(pane.blockId);
      const counts = new Map<number, number>();
      for (const seq of seqsIn(finalText)) counts.set(seq, (counts.get(seq) ?? 0) + 1);

      const paneLatency = newRows
        .filter((r) => seen.has(r.seq))
        .map((r) => (seen.get(r.seq)?.ended ?? 0) - Date.parse(r.at));
      const records = readRecords(out);
      const wireLatency = records.map((r) => r.wroteAt - Date.parse(r.at));
      const replayed = replay(records, { entries: head.entries });
      const liveHash = hashState({ entries: live.entries });
      const replayHash = hashState(replayed);
      const dropped = replay([...records.slice(0, 5), ...records.slice(6)], {
        entries: head.entries,
      });
      const swapped = replay(
        [...records.slice(0, 5), records[6], records[5], ...records.slice(7)].filter(
          (r): r is (typeof records)[number] => r !== undefined,
        ),
        { entries: head.entries },
      );

      const keysLeft: string[] = [];
      for (let i = 0; i < SESSIONS; i++) {
        const left = await kvGet(urls.acmeUrl, "scratch", `e3/${RUN}/${i}`);
        if (left !== null) keysLeft.push(`e3/${RUN}/${i}`);
      }

      const p50 = percentile(paneLatency, 50);
      const p95 = percentile(paneLatency, 95);
      const recordedSeqs = records.map((r) => r.row.seq);
      const expectedSeqs = newRows.map((r) => r.seq);
      const kinds = Object.fromEntries(
        [...new Set(newRows.map((r) => r.name))]
          .sort()
          .map((n) => [n, newRows.filter((r) => r.name === n).length]),
      );
      const parts = {
        everyEventSeenInThePaneExactlyOnce:
          newRows.length > 0 && newRows.every((r) => counts.get(r.seq) === 1),
        paneLatencyP95Under1s: p95 !== null && p95 < 1000,
        recordingHoldsEveryEventInOrder:
          JSON.stringify(recordedSeqs) === JSON.stringify(expectedSeqs),
        replayHashEqualsLiveHash: replayHash === liveHash,
        droppingOneRecordChangesTheHash: hashState(dropped) !== liveHash,
        swappingTwoRecordsChangesTheHash: hashState(swapped) !== liveHash,
      };
      const verdict: Receipt["verdict"] =
        newRows.length === 0
          ? "inconclusive"
          : Object.values(parts).every(Boolean)
            ? "verified"
            : "verified-disproved";
      const receipt: Receipt = {
        schema: "mcp-trust/receipt/v1",
        experiment: "flight-recorder",
        claimId: "E3-flight-recorder",
        verdict,
        intent:
          "Every gateway event reaches a Rex terminal pane within 1 s p95, and replaying the recorded log rebuilds the FlightLog view exactly (same hash). The pane runs the bun recorder opened with rex split. One line per event: time, session, tool, provider (verified or not), the fence verdict, and the rejection name if there is one.",
        execution: {
          command: "bun experiments/flight-recorder/run.ts",
          startedAt,
          endedAt: new Date().toISOString(),
          ...gitInfo(),
          sessions: SESSIONS,
          concurrency: CONCURRENCY,
          seed: SEED,
          traffic:
            "Per session: 3 upstream servers register (acme, cloudflare, cloudflare-mcp), then 6 tool calls through the gateway over MCP with 60 to 260 ms between calls: read_document, kv_put to a named target, kv_put to an unnamed target, cloudflare__execute, cloudflare-mcp__execute, kv_delete. No model is involved.",
          latencyDefinition:
            "paneLatency = the time the polling `rex capture` of the pane returned with the line, minus the event's `at` from the FlightLog row. Poll loop back to back with 10 ms sleep. The capture end time is later than the moment the line was drawn, so the figure is an upper bound. wireLatency = the time the recorder finished writing the line to its stdout, minus `at`.",
          clock: "gateway, recorder and harness run on one machine and share one clock",
          replay:
            "FlightLog.evolve (the view's own fold) applied to the recorded raw domain events in recorded order, starting from the log state at the cursor where recording began.",
          passCriteria: parts,
          pane: { block: pane.blockId, recordingTo: ".dev/<run>.jsonl" },
        },
        evidence: {
          observed: {
            eventsRecorded: records.length,
            eventsByName: kinds,
            startingCursor: head.cursor,
            trafficMs,
            paneLatencyMs: {
              n: paneLatency.length,
              p50,
              p95,
              p99: percentile(paneLatency, 99),
              max: paneLatency.length ? Math.max(...paneLatency) : null,
              min: paneLatency.length ? Math.min(...paneLatency) : null,
            },
            wireLatencyMs: {
              n: wireLatency.length,
              p50: percentile(wireLatency, 50),
              p95: percentile(wireLatency, 95),
              max: wireLatency.length ? Math.max(...wireLatency) : null,
            },
            captureCallMs: {
              n: captureMs.length,
              p50: percentile(captureMs, 50),
              p95: percentile(captureMs, 95),
            },
            paneLinesPerEvent: {
              missing: newRows.filter((r) => !counts.get(r.seq)).length,
              duplicated: newRows.filter((r) => (counts.get(r.seq) ?? 0) > 1).length,
            },
            liveHash,
            replayHash,
            negativeControls: {
              droppedOneRecordHash: hashState(dropped),
              swappedTwoRecordsHash: hashState(swapped),
            },
            scratchKeysLeft: keysLeft,
            sampleLines: finalText
              .split("\n")
              .filter((l) => l.startsWith("#"))
              .slice(-12),
          },
          projected: {
            note: "Local run: gateway, recorder and pane on one machine. A deployed gateway adds network latency between the gateway and the recorder, and that is not measured here. The recorder reads the gateway with a long poll (FlightLog.list every 50 ms inside the gateway), not a push stream.",
            notProven: [
              "Latency with a deployed gateway.",
              "Behaviour when the recorder loses its connection and reconnects.",
              "Throughput above this traffic (about 23 events per session, 4 sessions at once).",
              "That replay would catch a bug in the view's fold, because it runs the same fold. It catches lost, duplicated and reordered events.",
            ],
          },
          realized: {},
        },
        constraintCleared: [
          {
            constraint: "A real Rex pane, opened with rex split",
            met: true,
            how: "The recorder ran in the pane. The harness read the pane with rex capture.",
          },
          {
            constraint: "Real gateway events from real MCP calls",
            met: true,
            how: "Sessions called real upstream Workers through the gateway over HTTP. No model output is involved or faked.",
          },
          {
            constraint: "No process or pane left behind",
            met: true,
            how: "The pane is closed with rex block close and the stack is stopped in finally blocks.",
          },
        ],
        cost: { workersAiCalls: 0, neurons: 0, kvWrites: SESSIONS * 2 },
      };
      if (OFFICIAL) writeReceipt("receipts/e3-flight-recorder.json", receipt);
      else writeFileSync("/tmp/e3-smoke.json", JSON.stringify(receipt, null, 2));
      console.log(
        JSON.stringify(
          {
            verdict,
            parts,
            events: records.length,
            paneLatencyMs: (receipt.evidence.observed as { paneLatencyMs: unknown }).paneLatencyMs,
            liveHash,
            replayHash,
          },
          null,
          2,
        ),
      );
    } finally {
      polling = false;
      await closePane(pane.blockId).catch(() => undefined);
    }
  });
};

await main();
