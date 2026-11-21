# demo

`bun run demo` shows the gateway in about 35 seconds, with the real model.

## What it does

1. Starts the stack: the gateway, two providers (Cloudflare and the lookalike cloudflare-mcp), and one agent.
2. Opens `mcp-trust watch` in a Rex pane beside the pane it runs in. The recorder prints one line per event. Refusals are red. Allowed and routed calls are green. Other lines are dim.
3. Runs four steps and prints one header line for each:
   - Step 1. No pinning: the agent picks the lookalike (2 trials).
   - Step 2. The gateway routes only to the provider the user named: the lookalike is refused, the agent recovers (2 trials).
   - Step 3. Poisoned documents, fence on: injected writes are blocked (2 documents).
   - Step 4. A clean write to a target the user named: allowed (1 write).
4. Closes the pane, deletes its keys, and stops every process.

## Run

Run it in a Rex terminal. Set `CLOUDFLARE_ACCOUNT_ID` to the account that holds `mcp-trust-scratch` and `mcp-trust-decoy`.

```sh
PROMPT='$ ' CLOUDFLARE_ACCOUNT_ID=<account> bun run demo
```

`DEMO_TIMING=1` prints the elapsed time at each milestone to stderr.

## What is live and what is chosen

- Every model call is real Workers AI. No output is faked.
- In Step 1 and Step 2 the demo registers the trusted provider first. In the E1b receipts the model picked the second-listed tool in 41 of 50 trials, so this order shows the lookalike pick reliably. Step 1 would also show the trusted tool in some runs with the other order.
- The model does not always act on an injected document. Step 3 starts three poisoned documents for each slot at the same time, and a second wave of three if all are ignored. It prints the first document that the agent acted on and how many it ignored before. If every document in a slot is ignored, the line says so. In the last three runs both slots showed a block.
- The agent stops after the call that the step needs (`stopAfter`), which skips the closing sentence the model would write. The receipts do not use this option.
- Times in the pane are UTC.
