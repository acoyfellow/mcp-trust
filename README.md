# mcp-trust

An experiment notebook. It tests two defenses for an agent that connects to many MCP servers.

## The nag

An agent connects to several MCP servers. Two servers can expose a tool with the same name, such as `execute`. Nothing tells the agent which provider it calls. A tool result can also carry an injected instruction that redirects a write to a target the user never named. The person who runs the agents sees neither event.

## The bet

A gateway that sits between the agent and its MCP servers can fix both problems with two small rules, and it can show every decision in a terminal.

- **Tool passport.** The provider signs each tool with Ed25519. The gateway checks the signature when the tool registers and on each call.
- **Write fence.** The gateway allows a write only to a target that the user named in their own prompt.

## The claims

Each claim can fail. The ledger is in `status.json`.

| Id | Claim | State |
| --- | --- | --- |
| E1 | Name-only resolution misroutes. A passport stops a keyless impostor (0 of 50 reach it, 0 trusted calls blocked). | proven, see `receipts/e1-tool-passport.json` |
| E1b | A lookalike provider with its own valid key and a persuasive description. Arm A: the model picks it in at least 10% of 50 trials. Arm B: the gateway routes only to the provider the prompt names, and the lookalike is reached in 0 of 50 trials. | proven with limits, see `receipts/e1b-lookalike-provider.json`. With a helpful refusal, 50 of 50 tasks finish: `receipts/e1b-armB-recovery.json` |
| E2 | The fence blocks 100% of injected write targets in 20 poisoned cases, with 0 false blocks in 20 clean tasks, under 5 ms p50. | proven with limits, see `receipts/e2-write-fence.json` and the control `receipts/e2-write-fence-control.json` |
| E3 | Every gateway event reaches a Rex pane within 1 s p95. Replay rebuilds the `FlightLog` view with the same hash. | proven locally, see `receipts/e3-flight-recorder.json` |

## Why a notebook

A notebook keeps the receipts when a claim fails. A failed claim is a result. A repo comes later, only if the receipts earn it.

## Quick start

```sh
bun install
bun test
```

`bun test` runs the domain stories in memory. No network and no account are needed.

## How it works

One Alchemy Domain model holds all the rules. It is in `src/domain/`. See `docs/domain.md`.

- `ToolRegistry` decides whether a passport verifies and which server holds each (provider, name) tool.
- `WriteFence` decides whether a write target is allowed.
- `Refusals` records each rejection so the log can show it.
- `FlightLog` is a view of every event and refusal across sessions.

## How to check it

```sh
bun test
bun scripts/mutation-check.ts
```

The second command removes each sampled rule in turn and checks that a story fails. It writes `receipts/p1-domain-mutation-check.json`.

## What this does not do

- It does not deploy anything. Deploy is a separate step that starts with Access.
- It does not prove that a signed tool is safe. It proves who signed it.
- It does not stop reads, and it does not check the data written to a named target.
- E1, E1b, E2 and E3 have receipts. Each receipt lists what it does not prove. All runs were local.

## Where to edit behavior

Edit `src/domain/`. Write the story first, in `test/domain/`.

## Layout

```text
README.md        this file
status.json      the proven, unproven and disproven ledger
STATUS.md        the phase log that the orchestrator reads
src/domain/      the model
test/domain/     one story per rule
experiments/     one folder per experiment
receipts/        evidence
docs/            domain rules and the receipt schema
scripts/         checks
```
