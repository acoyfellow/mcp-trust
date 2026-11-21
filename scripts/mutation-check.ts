import { readFileSync, writeFileSync } from "node:fs";

interface Mutation {
  readonly rule: string;
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

const mutations: ReadonlyArray<Mutation> = [
  {
    rule: "RegisterServer refuses a server id that exists (ServerAlreadyRegistered)",
    file: "src/domain/tool-registry.ts",
    from: "Object.hasOwn(registry.servers, cmd.serverId)\n        ? new ServerAlreadyRegistered",
    to: "false\n        ? new ServerAlreadyRegistered",
  },
  {
    rule: "RegisterTool verifies the passport signature (UnverifiedPassport)",
    file: "src/domain/tool-registry.ts",
    from: "!verifyPassport(server.publicKey",
    to: "false && !verifyPassport(server.publicKey",
  },
  {
    rule: "RegisterTool refuses a tool from an unregistered server (UnverifiedPassport)",
    file: "src/domain/tool-registry.ts",
    from: "server === undefined ||",
    to: "server === undefined && false ||",
  },
  {
    rule: "RegisterTool refuses a name bound to another server (NameCollision)",
    file: "src/domain/tool-registry.ts",
    from: "bound !== undefined && bound.server !== cmd.server) {\n        return new NameCollision",
    to: "false) {\n        return new NameCollision",
  },
  {
    rule: "RouteCall refuses a server the tool is not bound to (Misbinding)",
    file: "src/domain/tool-registry.ts",
    from: "if (bound === undefined || bound.server !== cmd.server) {",
    to: "if (bound === undefined) {",
  },
  {
    rule: "RouteCall refuses an unregistered tool (Misbinding)",
    file: "src/domain/tool-registry.ts",
    from: "if (bound === undefined || bound.server !== cmd.server) {",
    to: "if (bound !== undefined && bound.server !== cmd.server) {",
  },
  {
    rule: "RequestWrite refuses before targets are named (TargetsNotDeclared)",
    file: "src/domain/write-fence.ts",
    from: 'if (fence._tag === "Undeclared") {',
    to: 'if (fence._tag === "Undeclared" && false) {',
  },
  {
    rule: "RequestWrite refuses a target the user did not name (TargetNotNamed)",
    file: "src/domain/write-fence.ts",
    from: "fence.targets.includes(cmd.target)",
    to: "true",
  },
  {
    rule: "RequestWrite matches targets exactly",
    file: "src/domain/write-fence.ts",
    from: "fence.targets.includes(cmd.target)",
    to: "fence.targets.some((t) => cmd.target.startsWith(t))",
  },
  {
    rule: "NameTargets keeps targets from earlier turns",
    file: "src/domain/write-fence.ts",
    from: '...(s._tag === "Declared" ? s.targets : []), ',
    to: "",
  },
  {
    rule: "FlightLog numbers entries in order",
    file: "src/domain/flight-log.ts",
    from: "seq: state.entries.length + 1,",
    to: "seq: 0,",
  },
  {
    rule: "FlightLog marks fence refusals as blocked",
    file: "src/domain/flight-log.ts",
    from: 'new Set(["TargetNotNamed", "TargetsNotDeclared"])',
    to: "new Set<string>()",
  },
  {
    rule: "FlightLog marks a routed call's provider verified",
    file: "src/domain/flight-log.ts",
    from: "provider: e.provider,\n          verified: true,\n        }),\n      ),\n    TargetsNamed",
    to: "provider: e.provider,\n          verified: false,\n        }),\n      ),\n    TargetsNamed",
  },
];

const runTests = async (): Promise<{ failed: ReadonlyArray<string>; exit: number }> => {
  const proc = Bun.spawn(["bun", "test", "test/domain"], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exit = await proc.exited;
  const failed = [...new Set((out + err).split("\n").filter((l) => l.startsWith("(fail) ")))].map(
    (l) => l.replace(/^\(fail\) /, "").replace(/ \[[\d.]+ms\]$/, ""),
  );
  return { failed, exit };
};

const baseline = await runTests();
if (baseline.exit !== 0) {
  console.error("baseline is not green", baseline.failed);
  process.exit(1);
}

const results = [];
for (const m of mutations) {
  const original = readFileSync(m.file, "utf8");
  const count = original.split(m.from).length - 1;
  if (count !== 1) {
    results.push({ rule: m.rule, applied: false, reason: `pattern matched ${count} times` });
    continue;
  }
  writeFileSync(
    m.file,
    original.replace(m.from, () => m.to),
  );
  try {
    const { failed } = await runTests();
    results.push({ rule: m.rule, applied: true, failedStories: failed, caught: failed.length > 0 });
  } finally {
    writeFileSync(m.file, original);
  }
}

const final = await runTests();
const receipt = {
  schema: "mcp-trust/check/v1",
  check: "domain-mutation",
  command: "bun scripts/mutation-check.ts",
  observed: {
    baselineGreen: baseline.exit === 0,
    restoredGreen: final.exit === 0,
    mutations: results.length,
    caught: results.filter((r) => r.applied && r.caught).length,
    notApplied: results.filter((r) => !r.applied).length,
    results,
  },
};
writeFileSync("receipts/p1-domain-mutation-check.json", `${JSON.stringify(receipt, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      ...receipt.observed,
      results: results.map((r) => ({
        rule: r.rule,
        applied: r.applied,
        n: "failedStories" in r ? r.failedStories?.length : 0,
      })),
    },
    null,
    2,
  ),
);
if (!receipt.observed.restoredGreen || receipt.observed.caught !== receipt.observed.mutations)
  process.exit(1);
