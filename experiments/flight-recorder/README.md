# flight-recorder

Status: run. Receipt: `receipts/e3-flight-recorder.json`.

## Claim (E3)

Every gateway event reaches a Rex terminal pane within 1 s p95. Replaying the recorded log rebuilds the `FlightLog` view with the same hash.

The pane runs a `bun` recorder opened with `rex split`. It prints one line per event: sequence, time, session, event name, tool, provider with `verified` or `unverified`, the fence verdict, and the rejection name.

```text
#02946 22:41:16.935 e3-mwqzs6py-s1 RefusalRecorded tool=execute provider=cloudflare-mcp:unverified fence=n/a reject=ProviderNotNamed
```

The recorder also writes each event, with its raw domain event, to a JSONL file. Replay applies `FlightLog.evolve` to those events and hashes the result.

## Run

```sh
CLOUDFLARE_ACCOUNT_ID=<account with mcp-trust-scratch and mcp-trust-decoy> bun run e3
```

Run it inside a Rex terminal. The run needs no model. It opens a pane next to yours and closes it at the end. `E3_SESSIONS=2` runs a smoke test and writes to `/tmp`.

## Use

```sh
bun bin/mcp-trust.ts watch --gateway http://localhost:1337
bun bin/mcp-trust.ts replay flight.jsonl
bun bin/mcp-trust.ts close <block>
```
