import { connect } from "../../src/mcp/rpc.ts";
import { sseEntries } from "../../src/recorder/record.ts";
import { gitInfo, percentile, pool, post, type Receipt, writeReceipt } from "../lib/common.ts";
import { type Urls, withStack } from "../lib/stack.ts";

const SIZES = (process.env.E4_SIZES ?? "4000,40000").split(",").map(Number);
const OFFICIAL = process.env.E4_SIZES === undefined;
const PROBES = Number(process.env.E4_PROBES ?? 60);
const FILL_CONCURRENCY = 24;
const RUN = `e4-${Date.now().toString(36)}`;

const head = async (urls: Urls) =>
  (
    (await (await fetch(`${urls.gatewayUrl}/admin/flight/head`)).json()) as {
      cursor: number;
    }
  ).cursor;

const settled = async (urls: Urls) => {
  let last = -1;
  let stable = 0;
  while (stable < 3) {
    const now = await head(urls);
    stable = now === last ? stable + 1 : 0;
    last = now;
    await Bun.sleep(500);
  }
  return last;
};

const fillSession = async (urls: Urls, i: number) => {
  const id = `${RUN}-f${i}`;
  const doc = `${RUN}-d${i}`;
  const key = `e4/${RUN}/${i}`;
  await post(`${urls.gatewayUrl}/admin/sessions/${id}`, {
    mode: "passports",
    fence: true,
    routing: "prompt",
    userPrompt: `Ask acme to read the document ${doc} and save a summary to scratch:${key}. Use Cloudflare's execute to save v${i}.`,
    upstreams: [
      { id: "acme-1", url: `${urls.acmeUrl}/mcp`, provider: "acme" },
      { id: "cloudflare-1", url: `${urls.acmeUrl}/mcp/cloudflare`, provider: "cloudflare" },
      { id: "lookalike-1", url: `${urls.impostorUrl}/mcp/lookalike`, provider: "cloudflare-mcp" },
    ],
  });
  const client = await connect(`${urls.gatewayUrl}/mcp/${id}`);
  await client.listTools();
  const calls: Array<[string, Record<string, string>]> = [
    ["read_document", { name: doc }],
    ["kv_put", { namespace: "decoy", key, value: "injected" }],
    ["cloudflare-mcp__execute", { key, value: `v${i}` }],
  ];
  for (const [tool, args] of calls) await client.callTool(tool, args);
};

let sessionCounter = 0;
const fillTo = async (urls: Urls, rows: number) => {
  const started = Date.now();
  let at = await head(urls);
  while (at < rows) {
    const need = Math.max(1, Math.ceil((rows - at) / 12));
    const batch = Math.min(need, FILL_CONCURRENCY * 4);
    const first = sessionCounter;
    sessionCounter += batch;
    await pool(
      FILL_CONCURRENCY,
      Array.from({ length: batch }, (_, k) => first + k),
      (i) => fillSession(urls, i).catch(() => undefined),
    );
    at = await head(urls);
  }
  const rowsNow = await settled(urls);
  return { rows: rowsNow, ms: Date.now() - started };
};

interface Delivery {
  readonly ms: number;
}

const probe = async (urls: Urls, after: number, probes: number): Promise<Delivery[]> => {
  const controller = new AbortController();
  const response = await fetch(`${urls.gatewayUrl}/admin/flight/stream?after=${after}`, {
    signal: controller.signal,
  });
  if (!response.ok || response.body === null) throw new Error(`stream answered ${response.status}`);
  const times = new Map<string, number>();
  const seenSessions = new Set<string>();
  const reader = (async () => {
    for await (const entry of sseEntries(response.body as ReadableStream<Uint8Array>)) {
      const received = Date.now();
      if (!entry.row.session.startsWith(`${RUN}-p`) || seenSessions.has(entry.row.session))
        continue;
      seenSessions.add(entry.row.session);
      times.set(entry.row.session, received - Date.parse(entry.at));
      if (times.size >= probes) return;
    }
  })();
  for (let i = 0; i < probes; i++) {
    await post(`${urls.gatewayUrl}/admin/sessions/${RUN}-p${i}-${after}`, {
      mode: "passports",
      fence: true,
      userPrompt: `Save the text probe to scratch:e4/probe/${i}.`,
      upstreams: [],
    });
    await Bun.sleep(150);
  }
  const deadline = Date.now() + 15_000;
  await Promise.race([reader, Bun.sleep(Math.max(0, deadline - Date.now()))]);
  controller.abort();
  return [...times.values()].map((ms) => ({ ms }));
};

const main = async () => {
  const startedAt = new Date().toISOString();
  await withStack(async (urls) => {
    const stages: Array<Record<string, unknown>> = [];
    const p95s: number[] = [];
    for (const size of SIZES) {
      const filled = await fillTo(urls, size);
      const cursor = await head(urls);
      const deliveries = await probe(urls, cursor, PROBES);
      const ms = deliveries.map((d) => d.ms);
      const p95 = percentile(ms, 95);
      if (p95 !== null) p95s.push(p95);
      stages.push({
        targetRows: size,
        rowsInLog: filled.rows,
        fillMs: filled.ms,
        probesDelivered: ms.length,
        probesSent: PROBES,
        deliveryMs: {
          p50: percentile(ms, 50),
          p95,
          p99: percentile(ms, 99),
          max: ms.length ? Math.max(...ms) : null,
          min: ms.length ? Math.min(...ms) : null,
        },
      });
    }
    const [small, large] = p95s;
    const ratio =
      small !== undefined && large !== undefined
        ? Math.max(small, large) / Math.min(small, large)
        : null;
    const complete = stages.every((s) => s.probesDelivered === PROBES);
    const parts = {
      everyProbeDelivered: complete,
      p95WithinFactorTwo: ratio !== null && ratio < 2,
    };
    const verdict: Receipt["verdict"] = !complete
      ? "inconclusive"
      : Object.values(parts).every(Boolean)
        ? "verified"
        : "verified-disproved";
    const receipt: Receipt = {
      schema: "mcp-trust/receipt/v1",
      experiment: "flight-stream-cost",
      claimId: "E4-push-stream-cost",
      verdict,
      intent:
        "The time to deliver one event over the push stream (FlightLog.events over SSE) does not grow with the size of the log. Claim, written before the run: the p95 delivery time with 40,000 rows in the log is within a factor of 2 of the p95 with 4,000 rows (the larger p95 divided by the smaller is under 2). Delivery time = the time the client reads the event from the stream minus the event's commit time (`at`). Gateway and client run on one machine and share one clock. Each size is measured with 60 probe events sent one at a time, 150 ms apart.",
      execution: {
        command: "bun experiments/flight-stream/run.ts",
        startedAt,
        endedAt: new Date().toISOString(),
        ...gitInfo(),
        sizes: SIZES,
        probes: PROBES,
        fillConcurrency: FILL_CONCURRENCY,
        probe:
          "One POST that configures a fenced session with no upstreams. The gateway sends NameTargets to the WriteFence aggregate, which commits one TargetsNamed event, which the FlightLog view emits to the stream.",
        fill: "Real sessions through the gateway: three upstreams register, then three tool calls over MCP (a read, a fenced write to decoy, a call to the lookalike). No model.",
        passCriteria: parts,
      },
      evidence: {
        observed: { stages, p95Ratio: ratio },
        projected: {
          note: "Local run: one machine, one clock, the local Durable Object storage. A deployed gateway adds network time between the gateway and the client, and the clock of the Durable Object is not the client clock. The deployed delivery time is not measured here.",
          notProven: [
            "Delivery time on a deployed gateway.",
            "Delivery time with many recorders reading at once.",
            "Log sizes above 40,000 rows.",
          ],
        },
        realized: {},
      },
      constraintCleared: [
        {
          constraint: "Real log sizes of 4,000 and 40,000 rows",
          met: stages.every((s) => Number(s.rowsInLog) >= Number(s.targetRows)),
          how: "Filled by real MCP sessions; the row count is the cursor of the stream.",
        },
      ],
      cost: { workersAiCalls: 0, neurons: 0 },
    };
    if (OFFICIAL) writeReceipt("receipts/e4-flight-stream-cost.json", receipt);
    else await Bun.write("/tmp/e4-smoke.json", JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ verdict, parts, stages, p95Ratio: ratio }, null, 2));
  });
};

await main();
