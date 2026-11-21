# tool-passport

Status: run. Receipt: `receipts/e1-tool-passport.json`.

## Claim (E1)

Name-only resolution misroutes. When two servers expose `execute` and the gateway resolves the bare name by first match, the call goes to whichever server the gateway lists first. A passport stops a keyless impostor: the impostor's tools are refused at registration, no impostor call reaches it, and no trusted call is blocked. The naive arm measures the gateway rule, not the agent. Registration order is shuffled, so the naive rate follows that order.

A passport is an Ed25519 signature by the provider over the provider, the server URL, the tool name, and the schema hash. The operator pins each provider key.

## Run

```sh
CLOUDFLARE_ACCOUNT_ID=<account with mcp-trust-scratch and mcp-trust-decoy> bun run e1
```

`E1_TRIALS=2` runs a smoke test and writes to `/tmp`.
