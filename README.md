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
| E1 | Tool identity is (provider, name), so registration order decides nothing. Passports block 100% of impostor calls and 0% of trusted calls. Without them, an agent calls the impostor in at least 20% of 50 trials. | unproven |
| E2 | The fence blocks 100% of injected write targets in 20 poisoned cases, with 0 false blocks in 20 clean tasks, under 5 ms p50. | unproven |
| E3 | Every gateway event reaches a Rex pane within 1 s p95. Replay rebuilds the `FlightLog` view with the same hash. | unproven |

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
- Experiments E1 to E3 have not run yet. See `status.json`.

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
