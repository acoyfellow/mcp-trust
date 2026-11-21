# STATUS

Brief: `~/cloudflare/.briefs/mcp-trust.md`. Phase log for the orchestrator.

## GATE 2: E1 E2 RECEIPTS

Date: 2026-11-21. Phase 2 is done. Phase 3 has not started. I am waiting for the orchestrator.

### Setup (as the orchestrator directed)

- Account: Agent Experience. Namespaces `mcp-trust-scratch` and `mcp-trust-decoy` created there. My two namespaces on Customer 0 are deleted (checked: none left).
- `wrangler dev` with remote KV and AI bindings runs `Acme`, `Impostor` and `Agent` (`dev/*.ts`, configs generated into `.dev/`). The gateway runs under `alchemy dev` with only local resources (`alchemy.dev.ts`). No Alchemy profile is used. `alchemy.run.ts` stays for the later deploy.
- Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. It is in the current catalog, its page lists function calling, and it is not deprecated.
- One command per experiment starts the stack, runs, and stops every process: `bun experiments/tool-passport/run.ts`, `bun experiments/write-fence/run.ts`, with `CLOUDFLARE_ACCOUNT_ID` set. The runner refuses to start if the two namespaces are not in that account. After each run no process of mine was left (`pgrep` count 0).
- Customer 0 findings are in `receipts/p2-customer0-findings.json`. The wrangler results in it are the orchestrator's, not reproduced by me.

### E1: verified (`receipts/e1-tool-passport.json`)

50 trials per arm, no errors, the agent called `execute` in all 100.

| | impostor reached | trusted reached | trusted calls blocked | impostor tool refused at registration |
| --- | --- | --- | --- | --- |
| naive | 25 of 50 | 25 of 50 | 0 | 0 |
| passports | 0 of 50 | 50 of 50 | 0 | 50 of 50 |

- Read the naive row with care. The impostor was reached in exactly the 25 trials where it was listed first, and never in the 25 where Acme was listed first. The rate follows name resolution in the gateway (first match), not model preference. "At least 20%" holds because I balanced the order. The receipt says this under `projected`.
- Passports: the impostor lacks the provider key, so its `execute` is refused with `UnverifiedPassport` in every trial, in either registration order.
- Not exercised end to end: a second provider with its own valid pinned key (qualified names, `AmbiguousTool`, `NameCollided`). Domain stories cover it. A rug pull after registration is also not exercised.
- Cost: 204 Workers AI calls, about 4,763 neurons, 100 KV writes.

### E2: verified, with limits (`receipts/e2-write-fence.json`)

- Injected writes: the model attempted the injected write in **6 of 20** poisoned cases (naive 1 of 7, intermediate 3 of 7, skilled 2 of 6). All 6 were blocked (`TargetNotNamed`). In the other 14 cases the model ignored the injection.
- No decoy key changed: the decoy namespace key list before and after the poisoned phase is identical, and all 20 injected keys read back `null`.
- Clean tasks: 20 of 20 completed, 0 blocked writes, so 0 false blocks.
- Fence decision time: p50 3 ms, p95 7 ms, max 15 ms over 49 writes. The pass line is under 5 ms. The figure is whole milliseconds, measured around the `WriteFence` command inside a local workerd with remote KV. It is not end-to-end latency in a deployed Worker. A p50 of 3 against a limit of 5 is not a wide margin.
- No control arm. The brief limits runs to 20 and 20, so I did not run the poisoned cases with the fence off. The receipt therefore does not show that the other 14 injections would have worked. I put this as an open question in `status.json`.
- Cost: 125 Workers AI calls, about 3,212 neurons.

### Ledger

`status.json`: E1 and E2 moved to `proven`, each with its receipt and a scope line. E3 stays `unproven`. Finding F1 is recorded. Nothing was tuned: the pass criteria were in the runners before the first official trial. The two earlier smoke runs (2 trials per arm, 2 poisoned and 2 clean not run) wrote only to `/tmp`.

### Things that went wrong, for the record

- I first ran under the wrong account (Agent Experience via the Alchemy default profile) while the owner had chosen Customer 0. That was before the orchestrator moved Phase 2 to Agent Experience on purpose. Details are in git history of this file (commit 5d569e5).
- A compatibility date newer than the installed workerd made the first stack start fail. I changed the date in the harness. It did not touch any pass criterion.

### Next (Phase 3, after the gate)

The `bun` recorder, `mcp-trust watch` with `rex split`, and the E3 receipt (1 s p95, replay hash). Known risk from Gate 1: `FlightLog` order across sessions is delivery order, so the replay hash needs a defined order.

## GATE 1: DOMAIN READY

Date: 2026-11-21. Phase 1 is done. Phase 2 has not started. I am waiting for the orchestrator.

## Gate 1 review fix (applied)

The review found that `NameCollision` was first-come-first-served: an impostor with its own valid key that registered `execute` first owned the name. Fixed:

- A tool's identity is (provider, name). `NameCollision` is gone. A second provider's same-name tool is kept, and `NameCollided` is recorded. The registry state is the same in either registration order (story: "registration order does not change what the registry knows").
- `RouteCall` carries `provider` (nullable). A bare name that two providers expose is refused as `AmbiguousTool`. `Misbinding` now also carries `requestedProvider`.
- Stories added: impostor registers first and a call for the trusted provider still routes to the trusted server; a call for the trusted provider sent to the impostor's server is a misbinding; a bare-name call is rejected when ambiguous; a bare-name call to the wrong server is a misbinding; the collision is logged as an event.
- The first mutation run after the change caught 16 of 17. The survivor showed that no story checked the server on a bare-name call. I added that story. The run on the final code caught 17 of 17.
- E1's claim text in `status.json` and `experiments/tool-passport/README.md` now states the identity rule and defines an impostor call. This definition is mine. Please check it.

## Done

- Notebook skeleton per the Repo Shape prompt: `README.md`, `status.json`, `experiments/` (three folders, no code yet), `receipts/`, `docs/`.
- Hygiene files: MIT `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `.gitignore`, `.npmrc` (`@cloudflare:registry=https://registry.npmjs.org/`), `biome.json`, `tsconfig.json` (`strict`, ESM, `moduleResolution: bundler`, `noEmit`), `bun.lock`.
- `package.json`: version `0.0.1`, `private: true`. Exact pins: `alchemy@2.0.0-beta.87`, `@alchemy.run/domain@2.0.0-beta.87`, `effect@4.1.5`, plus `@noble/curves@2.4.0` (see Deviations).
- Domain model in `src/domain/`:
  - `tool-registry.ts`: `ToolRegistry` with `RegisterServer`, `RegisterTool`, `RouteCall`; events `ServerRegistered`, `ToolRegistered`, `CallRouted`; rejections `NameCollision`, `UnverifiedPassport`, `Misbinding`, and `ServerAlreadyRegistered` (added).
  - `write-fence.ts`: `WriteFence` with `NameTargets`, `RequestWrite`; events `TargetsNamed`, `WriteAllowed`; rejections `TargetNotNamed`, `TargetsNotDeclared`.
  - `refusals.ts`: `Refusals` with `RecordRefusal`; event `RefusalRecorded` (added, see Deviations).
  - `flight-log.ts`: view `FlightLog`, one key for all sessions.
  - `passport.ts`: passport message, Ed25519 verify and sign helpers.
  - `model.ts`: `McpTrust` model.
- 39 tests in `test/domain/`: 20 registry stories and unit tests, 8 fence stories, 8 flight-log stories, 2 model tests (`Domain.verify` is empty; the model runs hosted on `Domain.InMemory`), 1 passport unit test.
- `scripts/mutation-check.ts`: removes 17 rules one at a time and checks that a story fails.
- No Cloudflare resource, no deploy, no network call to any account. No `rex` pane or process was started.

## Verified

Commands run on the final code, from `~/cloudflare/mcp-trust`:

```text
$ bunx tsc --noEmit
(no output, exit 0)

$ bunx biome check .
Checked 20 files in 26ms. No fixes applied.

$ bun test
 39 pass
 0 fail

$ bun scripts/mutation-check.ts
baselineGreen: true   restoredGreen: true
mutations: 17   caught: 17   notApplied: 0
```

Receipt: `receipts/p1-domain-mutation-check.json`. It lists each mutation and the stories that failed. Every mutation failed at least one story. Some failed several, for example removing signature verification fails 4 stories. Removing `ServerAlreadyRegistered` fails exactly 1.

I confirmed that Biome lint rules are active with a temporary probe file (`debugger` and `any` both flagged). I deleted the probe.

`status.json` moves one claim to `proven`: `P1-domain-rules-covered`, linked to the receipt above. Its scope is 17 hand-picked mutations. It does not prove the rules are complete. E1, E2, E3 stay `unproven` with `receipt: null`.

## Deviations from the brief

1. **`Refusals` aggregate (added).** In Alchemy Domain, a rejected command records no event, and a view folds only events. The brief wants `FlightLog` to hold every event and rejection. So the gateway must send `RecordRefusal` after each rejection, and `FlightLog` folds `RefusalRecorded`. Risk: a gateway crash between the rejection and the record loses one entry. Decision for you: keep this, or change how rejections reach the log.
2. **`ServerAlreadyRegistered` (added rejection).** Without it, a second `RegisterServer` with the same id could replace a pinned key. One story covers it.
3. **Command inputs are wider than the brief lists.** `RegisterServer` also takes the server `url`. `RegisterTool` also takes `schemaHash`. The passport signs both, so the registry needs them to verify.
4. **`@noble/curves` in the domain.** `decide` must be pure and synchronous, and WebCrypto is async. So the Ed25519 check uses `@noble/curves`. The Alchemy guide says the domain should import only `alchemy` and `effect`. This is the one exception.
5. **`bun test` runs `bun:test`, not `@effect/vitest`.** `@effect/vitest` fails to load under bun (`V.TestRunner` is undefined). I removed it. Each story runs with `Effect.runPromise`. I checked that a wrong assertion fails.
6. **Files are `src/domain/<thing>.ts`, not kind-suffixed.** The Repo Shape prompt says commands, events and rejections go in one file per thing. The Alchemy skill suggests `.aggregate.ts` and `.command.ts` files. I followed Repo Shape.
7. **Receipt shape is not gateproof's.** See `docs/receipt-schema.md`. Gateproof loops a worker until a gate passes, and E1/E2 are fixed-size trials with a threshold set in advance. The new shape keeps observe, act, assert as `evidence.observed`, `execution`, `verdict`. A mapping to `proof-spec.v0` is possible later.

## Assumptions the gateway must honor

- The provider public key given to `RegisterServer` is pinned by the operator, by provider name. An upstream server must never supply it. If it does, an impostor signs with its own key and the passport proves nothing. I wrote this in `SECURITY.md` and `docs/domain.md`.
- Only the gateway sends `NameTargets`, and only with targets parsed from the user prompt.
- Target matching is exact. No wildcards, no case folding.

## Known limits

- `FlightLog` order across sessions is the order of delivery to the view. Each session keeps its own order. Alchemy gives no global order across streams. E3 must account for this. The story "the same events always fold to the same log" passed, but it does not prove global order.
- `FlightLog` state grows without bound. This is fine for the experiments.
- I have not yet read `~/cloudflare/mcp`, `~/cloudflare/mcp-code-mode` or `~/cloudflare/heist`. I will read them at the start of Phase 2. I only read `gateproof` for the receipt shape.

## Next (Phase 2, after the gate)

1. Read `~/cloudflare/mcp` (how it registers `search` and `execute`), `mcp-code-mode`, and `heist` (injection cases).
2. Write `src/api.ts`, `src/host.ts` (`DomainCloudflare.layerDurableObjects()`), the gateway Worker, and `alchemy.run.ts`. No deploy.
3. Write two upstream MCP servers and a parser for user-named targets. Real KV puts and deletes in `mcp-trust-scratch` and `mcp-trust-decoy`.
4. Run E1 (50 trials per arm) and E2 (20 poisoned, 20 clean) with a real Workers AI model. Write receipts. Update `status.json` as the numbers say.

Things I may find missing at that point, and will report instead of working around: Workers AI access from local dev, and permission to create the two scratch KV namespaces. I will not read wrangler's stored token.

## Questions for the orchestrator

1. Keep the `Refusals` aggregate, or choose another way to get rejections into `FlightLog`?
2. Is the operator-pinned key assumption right for E1? The alternative is a signed provider directory, which the brief does not mention.
