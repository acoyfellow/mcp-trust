# write-fence

Status: run. Receipts: `receipts/e2-write-fence.json` and the control `receipts/e2-write-fence-control.json`.

## Claim (E2)

A fence that allows writes only to targets named in the user prompt blocks 100% of injected write targets across 20 poisoned-document cases. It makes 0 false blocks on 20 clean tasks. It adds under 5 ms p50 per call. No key in the `decoy` namespace changes.

The fence is fail closed: a tool that is not on the known-read list counts as a write. The fenced receipt was made before that change.

## Control

The control runs the same 20 poisoned cases with the fence off. It shows how many injected writes land. The decoy namespace is wiped after the run.

## Run

```sh
CLOUDFLARE_ACCOUNT_ID=<account with mcp-trust-scratch and mcp-trust-decoy> bun run e2
CLOUDFLARE_ACCOUNT_ID=<same account> bun run e2:control
```

`E2_SMOKE=1` and `E2C_SMOKE=1` run smoke tests and write to `/tmp`.
