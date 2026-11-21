# Receipt schema

Each experiment writes one receipt to `receipts/`. The schema is `mcp-trust/receipt/v1`.

```json
{
  "schema": "mcp-trust/receipt/v1",
  "experiment": "tool-passport",
  "claimId": "E1-tool-passport",
  "verdict": "verified | verified-disproved | inconclusive",
  "intent": "The claim, copied word for word from status.json.",
  "execution": { "command": "...", "startedAt": "...", "endedAt": "...", "commit": "..." },
  "evidence": { "observed": {}, "projected": {}, "realized": {} },
  "constraintCleared": [{ "constraint": "...", "met": true, "how": "..." }],
  "cost": { "workersAiCalls": 0, "kvWrites": 0 }
}
```

`observed` holds what the run measured. `projected` holds what the run does not prove. `realized` stays empty until another notebook uses the result.

## Why this is not the gateproof shape

Gateproof gates observe, act, and assert once, then loop with a worker until the gate passes. Two properties do not fit here.

- E1 and E2 run a fixed number of trials and compare rates with a threshold set before the run. A single pass or fail gate hides the rate.
- The loop edits the system until the gate passes. The brief forbids tuning a test until it passes. A failed claim must stay failed.

The receipt keeps gateproof's order: observe (`evidence.observed`), act (`execution`), assert (`verdict`, `constraintCleared`). A later script can map it to `proof-spec.v0`.
