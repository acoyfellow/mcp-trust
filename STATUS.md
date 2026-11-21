# STATUS

Brief: `~/cloudflare/.briefs/mcp-trust.md`. Phase log for the orchestrator.

## GATE 1: DOMAIN READY

Date: 2026-11-21. Phase 1 is done. Phase 2 has not started. I am waiting for the orchestrator.

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
- 33 tests in `test/domain/`: 15 registry stories, 8 fence stories, 7 flight-log stories, 2 model tests (`Domain.verify` is empty; the model runs hosted on `Domain.InMemory`), 1 passport unit test.
- `scripts/mutation-check.ts`: removes 13 rules one at a time and checks that a story fails.
- No Cloudflare resource, no deploy, no network call to any account. No `rex` pane or process was started.

## Verified

Commands run on the final code, from `~/cloudflare/mcp-trust`:

```text
$ bunx tsc --noEmit
(no output, exit 0)

$ bunx biome check .
Checked 20 files in 26ms. No fixes applied.

$ bun test
 33 pass
 0 fail
 20 expect() calls
Ran 33 tests across 4 files. [208.00ms]

$ bun scripts/mutation-check.ts
baselineGreen: true   restoredGreen: true
mutations: 13   caught: 13   notApplied: 0
```

Receipt: `receipts/p1-domain-mutation-check.json`. It lists each mutation and the stories that failed. Every mutation failed at least one story. Some failed several, for example removing signature verification fails 4 stories. Removing `ServerAlreadyRegistered` fails exactly 1.

I confirmed that Biome lint rules are active with a temporary probe file (`debugger` and `any` both flagged). I deleted the probe.

`status.json` moves one claim to `proven`: `P1-domain-rules-covered`, linked to the receipt above. Its scope is 13 hand-picked mutations. It does not prove the rules are complete. E1, E2, E3 stay `unproven` with `receipt: null`.

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
