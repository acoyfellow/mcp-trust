import { rmSync, writeFileSync } from "node:fs";
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
import { driveSession, flightHead, seqsIn, sleep } from "./lib.ts";

const SESSIONS = Number(process.env.E3B_SESSIONS ?? 12);
const OFFICIAL = SESSIONS === 12;
const CONCURRENCY = 4;
const SEED = 20261124;
const RUN = `e3b-${Date.now().toString(36)}`;
const CUTS: ReadonlyArray<{ afterMs: number; forMs: number }> = [
  { afterMs: 2000, forMs: 2500 },
  { afterMs: 6500, forMs: 2500 },
];

const startProxy = async (target: string, port = 0) => {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      return Bun.serve({
        port,
        hostname: "127.0.0.1",
        idleTimeout: 60,
        fetch: (request) => {
          const url = new URL(request.url);
          return fetch(`${target}${url.pathname}${url.search}`, {
            method: request.method,
            headers: request.headers,
          });
        },
      });
    } catch (error) {
      if (attempt === 39) throw error;
      await sleep(250);
    }
  }
  throw new Error("proxy did not start");
};

const main = async () => {
  const startedAt = new Date().toISOString();
  await withStack(async (urls) => {
    const head = await flightHead(urls.gatewayUrl);
    const out = `${repoRoot}/.dev/${RUN}.jsonl`;
    rmSync(out, { force: true });
    let proxy = await startProxy(urls.gatewayUrl);
    const proxyPort = proxy.port;
    const pane = await startPane({
      gateway: `http://127.0.0.1:${proxyPort}`,
      out,
      after: head.cursor,
    });
    const seen = new Map<number, number>();
    let polling = true;
    let lastText = "";
    const poller = (async () => {
      while (polling) {
        const text = await paneCapture(pane.blockId);
        const ended = Date.now();
        lastText = text;
        for (const seq of seqsIn(text)) if (!seen.has(seq)) seen.set(seq, ended);
        await sleep(10);
      }
    })();
    const outages: Array<{ from: number; to: number }> = [];
    try {
      for (let waited = 0; !/mcp-trust recording/.test(lastText); waited += 100) {
        if (waited > 20_000) throw new Error("the pane never showed the recording banner");
        await sleep(100);
      }
      const rng = mulberry32(SEED);
      const t0 = Date.now();
      const cutter = (async () => {
        for (const cut of CUTS) {
          await sleep(Math.max(0, t0 + cut.afterMs - Date.now()));
          const from = Date.now();
          proxy.stop(true);
          await sleep(cut.forMs);
          proxy = await startProxy(urls.gatewayUrl, proxyPort);
          outages.push({ from, to: Date.now() });
        }
      })();
      await pool(
        CONCURRENCY,
        Array.from({ length: SESSIONS }, (_, i) => i),
        (i) => driveSession(urls, RUN, i, rng),
      );
      await cutter;
      const restoredAt = outages.at(-1)?.to ?? Date.now();

      const live = (await (await fetch(`${urls.gatewayUrl}/admin/flight`)).json()) as {
        entries: FlightRow[];
      };
      const newRows = live.entries.slice(head.entries.length);
      for (let waited = 0; waited < 30_000; waited += 100) {
        if (newRows.every((r) => seen.has(r.seq))) break;
        await sleep(100);
      }
      const lastSeenAt = Math.max(...[...seen.values()]);
      polling = false;
      await poller;
      const finalText = await paneCapture(pane.blockId);
      const counts = new Map<number, number>();
      for (const seq of seqsIn(finalText)) counts.set(seq, (counts.get(seq) ?? 0) + 1);

      const records = readRecords(out);
      const recordedSeqs = records.map((r) => r.row.seq);
      const expectedSeqs = newRows.map((r) => r.seq);
      const replayHash = hashState(replay(records, { entries: head.entries }));
      const liveHash = hashState({ entries: live.entries });
      const inOutage = (r: FlightRow) =>
        outages.some((o) => Date.parse(r.at) >= o.from && Date.parse(r.at) <= o.to);
      const duringOutage = newRows.filter(inOutage);
      const delay = duringOutage
        .filter((r) => seen.has(r.seq))
        .map((r) => (seen.get(r.seq) ?? 0) - Date.parse(r.at));
      const waitingLines = (finalText.match(/^mcp-trust waiting for the gateway/gm) ?? []).length;
      const missing = expectedSeqs.filter((s) => !recordedSeqs.includes(s));
      const duplicated = recordedSeqs.filter((s, i) => recordedSeqs.indexOf(s) !== i);
      const parts = {
        zeroEventsLostInTheRecording: missing.length === 0,
        zeroEventsDuplicatedInTheRecording: duplicated.length === 0,
        recordingInOrderAndComplete: JSON.stringify(recordedSeqs) === JSON.stringify(expectedSeqs),
        everyEventInThePaneExactlyOnce:
          newRows.length > 0 && newRows.every((r) => counts.get(r.seq) === 1),
        replayHashEqualsLiveHash: replayHash === liveHash,
        outageWasReal:
          outages.length === CUTS.length && duringOutage.length > 0 && waitingLines > 0,
      };
      const verdict: Receipt["verdict"] =
        newRows.length === 0
          ? "inconclusive"
          : Object.values(parts).every(Boolean)
            ? "verified"
            : "verified-disproved";
      const leftKeys: string[] = [];
      for (let i = 0; i < SESSIONS; i++) {
        if ((await kvGet(urls.acmeUrl, "scratch", `e3/${RUN}/${i}`)) !== null)
          leftKeys.push(`${i}`);
      }
      const receipt: Receipt = {
        schema: "mcp-trust/receipt/v1",
        experiment: "recorder-reconnect",
        claimId: "E3b-recorder-reconnect",
        verdict,
        intent:
          "When the connection between the recorder and the gateway is cut mid-run, the recorder resumes from its cursor with 0 events lost and 0 duplicated. The recording holds every event once in order, the pane shows each event exactly once, and replay still gives the live hash. Two cuts, 2.5 s each, while 12 sessions send traffic.",
        execution: {
          command: "bun experiments/flight-recorder/reconnect.ts",
          startedAt,
          endedAt: new Date().toISOString(),
          ...gitInfo(),
          sessions: SESSIONS,
          concurrency: CONCURRENCY,
          seed: SEED,
          cuts: CUTS,
          how: "The recorder in the Rex pane reads the gateway through a local proxy. The harness stops the proxy with closeActiveConnections, which kills the open stream, waits, and starts it again on the same port. Traffic goes straight to the gateway and continues during each cut.",
          passCriteria: parts,
          pane: { block: pane.blockId },
        },
        evidence: {
          observed: {
            eventsExpected: expectedSeqs.length,
            eventsRecorded: recordedSeqs.length,
            missingSeqs: missing,
            duplicatedSeqs: duplicated,
            paneMissing: newRows.filter((r) => !counts.get(r.seq)).length,
            paneDuplicated: newRows.filter((r) => (counts.get(r.seq) ?? 0) > 1).length,
            outages: outages.map((o) => ({ ms: o.to - o.from })),
            eventsCreatedDuringOutages: duringOutage.length,
            recorderWaitingLinesInPane: waitingLines,
            catchUp: {
              msFromRestoreToLastEventInPane: lastSeenAt - restoredAt,
              delayOfEventsCreatedDuringOutageMs: {
                n: delay.length,
                p50: percentile(delay, 50),
                max: delay.length ? Math.max(...delay) : null,
              },
            },
            liveHash,
            replayHash,
            scratchKeysLeft: leftKeys,
            paneTail: finalText.split("\n").slice(-14),
          },
          projected: {
            note: "The cut is a local proxy that drops its sockets and refuses connections. It is not a network partition between machines. The recorder process stayed alive. A recorder that is killed and restarted resumes only if it is started with the cursor, and the CLI has no resume flag yet.",
            notProven: [
              "A recorder process that is killed and restarted.",
              "Outages longer than the gateway keeps events (the local log keeps all of them).",
              "A deployed gateway.",
            ],
          },
          realized: {},
        },
        constraintCleared: [
          {
            constraint: "A real Rex pane running the real recorder",
            met: true,
            how: "Opened with rex split, read with rex capture, closed with rex block close.",
          },
          {
            constraint: "Real gateway events from real MCP calls",
            met: true,
            how: "Same traffic as E3. No model.",
          },
        ],
        cost: { workersAiCalls: 0, neurons: 0, kvWrites: SESSIONS * 2 },
      };
      if (OFFICIAL) writeReceipt("receipts/e3b-recorder-reconnect.json", receipt);
      else writeFileSync("/tmp/e3b-smoke.json", JSON.stringify(receipt, null, 2));
      console.log(
        JSON.stringify(
          {
            verdict,
            parts,
            observed: {
              ...(receipt.evidence.observed as object),
              liveHash: undefined,
              missingSeqs: undefined,
              replayHash: undefined,
            },
          },
          null,
          2,
        ),
      );
    } finally {
      polling = false;
      proxy.stop(true);
      await closePane(pane.blockId).catch(() => undefined);
    }
  });
};

await main();
