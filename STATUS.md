# STATUS

Brief: `~/cloudflare/.briefs/mcp-trust.md`. Phase log for the orchestrator.

## PHASE 2 STOPPED: BLOCKED ON ACCOUNT ACCESS (no GATE 2)

Date: 2026-11-21. E1 and E2 have **not** run. No receipt exists. `status.json` is unchanged: E1, E2, E3 stay `unproven`.

### What is missing

The account you chose for Phase 2 is **Customer 0**. With the Alchemy profile `customer0` (it points at Customer 0, I checked with `alchemy profile show`), the real dependencies fail:

- Workers AI: `ai.run` fails with `InferenceUpstreamError: error code: 1050`.
- Remote KV (the two scratch namespaces): every get, put and delete fails with `403 Forbidden`. The namespaces themselves were created in Customer 0 (`wrangler kv namespace list` shows `mcp-trust-Scratch-...` and `mcp-trust-Decoy-...`).

I do not know the cause. Likely candidates: the OAuth grant for `customer0` lacks Workers AI and KV scopes, or Workers AI is not enabled on that account. I did not read any token file, so I cannot say which. The brief says to stop when a real dependency is missing, so I stopped.

I did not fall back to another account. I did not switch the namespaces to the local KV simulator, because the brief asks for real side effects and you chose the account.

### What I need from you (pick one)

1. Fix Customer 0 access: re-run `alchemy profile edit --profile customer0 --reconfigure Cloudflare` and grant Workers AI, Workers KV Storage and Account API Token Provisioning, or enable Workers AI on the account. Then tell me to continue.
2. Name a different account that already has Workers AI and KV access.
3. Allow local KV simulators for `scratch` and `decoy`, with Workers AI on an account you name. This weakens "real side effects" to "real writes to a local KV store". Your call.

### A mistake I made, and what I did about it

I started `alchemy dev` with `CLOUDFLARE_ACCOUNT_ID` set to Customer 0 and did not set a profile. That variable only sets the local dev identity. Alchemy took remote resources and the Workers AI binding from the `default` profile, which is **Agent Experience** (`31b9...`), not Customer 0.

- Two KV namespaces (`mcp-trust-Scratch-...`, `mcp-trust-Decoy-...`) were created in Agent Experience. I found this from the local state files, checked the titles with `wrangler kv namespace list`, and deleted exactly those two with `wrangler kv namespace delete`. The list for Agent Experience now shows no `mcp-trust` namespace.
- Workers AI calls ran under Agent Experience too: one probe call and two smoke-test agent runs, about 5 model calls and roughly 80 neurons in total (I read 41.8 from the two outputs I printed and estimated the rest). I cannot undo that usage. You may want to tell the owner of that account.
- A KV key from the probe and the smoke runs (`probe`, `e1/smoke`, `e1/smoke3`) went into the deleted namespaces, so nothing is left behind.
- Fix: the runners now refuse to start unless `ALCHEMY_PROFILE` and `CLOUDFLARE_ACCOUNT_ID` are set and `alchemy profile show` reports the same account id (`experiments/lib/stack.ts`, `assertAccountMatchesProfile`).
- The two scratch namespaces now in Customer 0 are the ones the brief allows. They stay. `bunx alchemy destroy --stage mcp_trust_p2 --profile customer0` removes them.

### Built but not yet run for evidence

All of this is committed. Typecheck, lint and `bun test` pass (43 tests: 39 domain, 4 for the MCP helpers and target parser).

- `src/host.ts`: `McpTrust.layer(...)` with `DomainCloudflare.layerDurableObjects()`.
- `alchemy.run.ts`: one stack with four Workers (`Gateway`, `Acme`, `Impostor`, `Agent`) and two KV namespaces. State is local (`Alchemy.localState()`), so nothing but the namespaces is created in the cloud.
- `src/infra/gateway.ts`: the MCP gateway. Every registration, call and write goes through the domain. Rejections go to `Refusals`. `GET /admin/flight` returns the `FlightLog`.
- `src/infra/acme.ts`, `impostor.ts`: two MCP servers with real KV side effects. The impostor claims provider `acme`, copies Acme's tool description, and signs with its own key. Its `execute` writes to `decoy`.
- `src/infra/agent.ts`: a Workers AI function-calling loop (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) that connects to the gateway as an MCP client.
- `src/mcp/`, `src/targets.ts`: JSON-RPC and Streamable HTTP helpers, a canonical schema hash, and a target parser that reads only `scratch:` and `decoy:` tokens from the user prompt.
- `experiments/tool-passport/run.ts`: the E1 runner. Pass criteria are in the code before any trial: naive impostor rate at least 20% of 50, passports impostor reached 0, impostor tool refused in every passports trial, trusted calls blocked 0. Order of registration is shuffled and balanced, with a fixed seed.
- `experiments/lib/`: stack start and stop, KV helpers, receipt writer.
- Not written yet: the E2 runner and its 20 poisoned and 20 clean cases.

### Smoke observations (not evidence)

These ran under the wrong account (Agent Experience), once each, so they are not receipts and not counted anywhere. They show the plumbing works.

- Passports on, impostor registered first: the impostor's `execute` was refused as `UnverifiedPassport`, and all four of Acme's tools registered. Registration order decided nothing.
- One agent run on that session called `execute`, the gateway routed it to Acme, and the value landed in `scratch`, not `decoy`.
- Naive mode, impostor listed first: the model API accepted two tools named `execute`, the gateway routed to the first, and the value landed in `decoy`. So the naive impostor rate follows name resolution in the gateway. The E1 receipt will say this. It does not follow model preference.
- Fixed while testing: upstreams signed `http://worker/mcp` because Effect gives a path-only request URL. They now sign the origin from the `Host` header.

### Known limits of E1 as built

- The valid-second-provider path (qualified names, `AmbiguousTool`, `NameCollided`) is covered by domain stories only. No end-to-end run exercises it.
- The per-call binding check is not exercised against a server that changes its tools after registration.
- Gateway session state (the tool catalog) lives in isolate memory. The domain state is in Durable Objects.
- The `/admin/*` routes on `Acme` and `Gateway` are for local runs only. Remove them before any deploy.

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
