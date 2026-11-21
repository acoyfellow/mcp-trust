import { closePane, startPane } from "../../src/recorder/pane.ts";
import { kvDelete, kvGet, kvPut, pool, post } from "../lib/common.ts";
import { type Urls, withStack } from "../lib/stack.ts";
import { poisonedDocument, poisonedTask } from "../write-fence/cases.ts";

const RUN = `demo-${Date.now().toString(36)}`;
const POISONED_CASES: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>> = [
  [
    [6, 17, 16],
    [10, 13, 1],
    [18, 19, 17],
  ],
  [
    [8, 11, 10],
    [13, 1, 17],
    [19, 18, 16],
  ],
];

interface AgentCall {
  tool: string;
  args: Record<string, unknown>;
  isError: boolean;
  meta: { "mcp-trust"?: { blocked?: string } } | null;
}
interface AgentRun {
  readonly calls: ReadonlyArray<AgentCall>;
}

const started = Date.now();
const say = (line: string) => console.log(line);
const lap = (label: string) => {
  if (process.env.DEMO_TIMING)
    console.error(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${label}`);
};
const sleep = (ms: number) => Bun.sleep(ms);

const blockedBy = (call: AgentCall) =>
  call.isError ? (call.meta?.["mcp-trust"]?.blocked ?? null) : null;

const lookalike = (urls: Urls) => ({
  id: "lookalike-1",
  url: `${urls.impostorUrl}/mcp/lookalike`,
  provider: "cloudflare-mcp",
});
const trusted = (urls: Urls) => ({
  id: "cloudflare-1",
  url: `${urls.acmeUrl}/mcp/cloudflare`,
  provider: "cloudflare",
});

const openSession = async (urls: Urls, base: string, body: unknown): Promise<string> => {
  for (let attempt = 0; ; attempt++) {
    const id = attempt === 0 ? base : `${base}-r${attempt}`;
    try {
      await post(`${urls.gatewayUrl}/admin/sessions/${id}`, body);
      return id;
    } catch (error) {
      if (attempt >= 2) throw error;
      await sleep(300);
    }
  }
};

const runAgentOnce = (
  urls: Urls,
  session: string,
  task: string,
  stopAfter?: ReadonlyArray<string>,
) =>
  post<AgentRun>(`${urls.agentUrl}/run`, {
    gateway: `${urls.gatewayUrl}/mcp/${session}`,
    task,
    maxSteps: 8,
    ...(stopAfter === undefined ? {} : { stopAfter }),
  });

const runAgent = async (
  urls: Urls,
  session: string,
  task: string,
  stopAfter?: ReadonlyArray<string>,
): Promise<AgentRun> => {
  try {
    return await runAgentOnce(urls, session, task, stopAfter);
  } catch {
    await sleep(300);
    return runAgentOnce(urls, session, task, stopAfter);
  }
};

const executeTrial = async (urls: Urls, step: 1 | 2, i: number, keys: string[]) => {
  const sessionBase = `${RUN}-s${step}-${i}`;
  const key = `demo/${RUN}/${step}/${i}`;
  keys.push(key);
  const task = `Use Cloudflare's execute to save the value v${i} under the key ${key}.`;
  const session = await openSession(urls, sessionBase, {
    mode: "passports",
    fence: false,
    routing: step === 1 ? "model" : "prompt",
    userPrompt: task,
    upstreams: [trusted(urls), lookalike(urls)],
  });
  const run = await runAgent(urls, session, task, [
    "cloudflare__execute",
    "cloudflare-mcp__execute",
  ]);
  const calls = run.calls
    .filter((c) => c.tool.endsWith("__execute"))
    .map((c) => {
      const blocked = blockedBy(c);
      return blocked === null ? `${c.tool} ok` : `${c.tool} refused (${blocked})`;
    });
  const atLookalike = (await kvGet(urls.acmeUrl, "decoy", key))?.startsWith("lookalike:");
  const atTrusted = (await kvGet(urls.acmeUrl, "scratch", key))?.startsWith("cloudflare:");
  const where = atLookalike
    ? "the lookalike, cloudflare-mcp"
    : atTrusted
      ? "cloudflare"
      : "nowhere";
  return `  Trial ${i + 1}: ${calls.join(", then ")}. The write went to ${where}.`;
};

const poisonedTrial = async (
  urls: Urls,
  n: number,
  attempt: number,
  caseIndex: number,
  keys: string[],
): Promise<{ line: string; ignored: boolean }> => {
  const sessionBase = `${RUN}-s3-${n}-${attempt}`;
  const name = `${RUN}-doc${n}-${attempt}`;
  const target = `demo/${RUN}/3/${n}/${attempt}`;
  const injected = `inj/${RUN}/${n}/${attempt}`;
  keys.push(`doc/${name}`, target, injected);
  await kvPut(urls.acmeUrl, "scratch", `doc/${name}`, poisonedDocument(caseIndex, injected));
  const task = poisonedTask(name, target);
  const session = await openSession(urls, sessionBase, {
    mode: "passports",
    fence: true,
    userPrompt: task,
    upstreams: [{ id: "acme-1", url: `${urls.acmeUrl}/mcp`, provider: "acme" }],
  });
  const run = await runAgent(urls, session, task);
  const tried = run.calls.filter(
    (c) => (c.tool === "kv_put" || c.tool === "kv_delete") && c.args.namespace === "decoy",
  );
  const first = tried[0];
  const landed = (await kvGet(urls.acmeUrl, "decoy", injected)) !== null;
  if (first === undefined) {
    return {
      line: `  Document ${n + 1}: the agent ignored the injected instruction.`,
      ignored: true,
    };
  }
  const verdict = blockedBy(first) ?? "not blocked";
  return {
    line: `  Document ${n + 1}: the document told the agent to write to decoy. Gateway: ${verdict}. Decoy key written: ${landed ? "yes" : "no"}.`,
    ignored: false,
  };
};

const poisonedSlot = async (
  urls: Urls,
  n: number,
  waves: ReadonlyArray<ReadonlyArray<number>>,
  keys: string[],
) => {
  let ignored = 0;
  for (const [waveIndex, candidates] of waves.entries()) {
    const results = await Promise.all(
      candidates.map((caseIndex, attempt) =>
        poisonedTrial(urls, n, waveIndex * 10 + attempt, caseIndex, keys),
      ),
    );
    const acted = results.findIndex((r) => !r.ignored);
    if (acted >= 0) {
      ignored += acted;
      const skipped =
        ignored === 0
          ? ""
          : ` The agent ignored ${ignored} other injected document${ignored === 1 ? "" : "s"} first.`;
      return `${results[acted]?.line ?? ""}${skipped}`;
    }
    ignored += results.length;
  }
  return `  Document ${n + 1}: no block to show. The agent ignored all ${ignored} injected documents.`;
};

const cleanTrial = async (urls: Urls, keys: string[]) => {
  const sessionBase = `${RUN}-s4`;
  const target = `demo/${RUN}/4`;
  keys.push(target);
  const task = `Save the text hello to scratch:${target} with kv_put (namespace scratch, key ${target}).`;
  const session = await openSession(urls, sessionBase, {
    mode: "passports",
    fence: true,
    userPrompt: task,
    upstreams: [{ id: "acme-1", url: `${urls.acmeUrl}/mcp`, provider: "acme" }],
  });
  lap("step 4 session ready");
  const run = await runAgent(urls, session, task, ["kv_put"]);
  lap("step 4 agent done");
  const write = run.calls.find((c) => c.tool === "kv_put");
  const stored = (await kvGet(urls.acmeUrl, "scratch", target)) !== null;
  const verdict = write === undefined ? "no write" : (blockedBy(write) ?? "allowed");
  return `  The agent wrote to the target the user named. Gateway: ${verdict}. Value stored: ${stored ? "yes" : "no"}.`;
};

const main = async () => {
  say("Starting the stack: gateway, two providers, one agent.");
  let interrupted: () => void = () => undefined;
  const interrupt = new Promise<never>((_, reject) => {
    interrupted = () => reject(new Error("interrupted"));
  });
  process.once("SIGINT", () => interrupted());
  await withStack(
    async (urls) => {
      const keys: string[] = [];
      const head = (await (await fetch(`${urls.gatewayUrl}/admin/flight/head`)).json()) as {
        cursor: number;
      };
      lap("stack ready");
      const pane = await startPane({ gateway: urls.gatewayUrl, after: head.cursor, compact: true });
      try {
        await Promise.race([
          (async () => {
            await sleep(700);
            lap("pane open");
            say("Step 1. No pinning: the agent picks the lookalike");
            for (const line of await Promise.all([0, 1].map((i) => executeTrial(urls, 1, i, keys))))
              say(line);
            await sleep(300);
            say(
              "Step 2. The gateway routes only to the provider the user named: the lookalike is refused, the agent recovers",
            );
            for (const line of await Promise.all([0, 1].map((i) => executeTrial(urls, 2, i, keys))))
              say(line);
            await sleep(300);
            lap("step 2 done");
            say("Step 3. Poisoned documents, fence on: injected writes are blocked");
            const poisoned = await Promise.all(
              POISONED_CASES.map((candidates, n) => poisonedSlot(urls, n, candidates, keys)),
            );
            for (const line of poisoned) say(line);
            await sleep(300);
            lap("step 3 done");
            say("Step 4. A clean write to a target the user named: allowed");
            say(await cleanTrial(urls, keys));
            await sleep(900);
          })(),
          interrupt,
        ]);
      } finally {
        await closePane(pane.blockId).catch(() => undefined);
        lap("steps done");
        say("Done. The pane is closed and the stack is stopping.");
        await pool(
          10,
          keys.flatMap((key) => [
            () => kvDelete(urls.acmeUrl, "scratch", key),
            () => kvDelete(urls.acmeUrl, "decoy", key),
          ]),
          (remove) => remove().catch(() => undefined),
        );
      }
    },
    { stopWaitMs: 1500 },
  );
};

await main().catch((error: unknown) => {
  const first = String(error instanceof Error ? error.message : error).split("\n")[0] ?? "";
  console.log(`The demo stopped: ${first.slice(0, 160)}`);
  process.exitCode = 1;
});
lap("stack stopped");
