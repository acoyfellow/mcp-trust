# Receipts

Each file here is evidence for one claim. See `docs/receipt-schema.md`.

- `e1-tool-passport.json`: E1, 50 trials per arm. Name-only resolution and a keyless impostor.
- `e1b-lookalike-provider.json`: E1b, 50 trials per arm. A lookalike provider with its own valid key. This is also the before for the recovery run.
- `e1b-armB-recovery.json`: E1b arm B again, with a refusal that names the provider and the tool.
- `e2-write-fence.json`: E2 on the fail-closed fence, 20 poisoned cases and 20 clean tasks.
- `e2-write-fence-pre-failclosed.json`: E2 before the fail-closed change.
- `e2-write-fence-inconclusive-worker-restart.json`: an E2 rerun that the harness broke. Kept as a record.
- `e2-write-fence-control.json`: E2 control, 20 poisoned cases with the fence off.
- `e2-write-fence-control-stale-list.json`: the first control run. Its verdict was a harness fault.
- `e3-flight-recorder.json`: E3, 460 events in a Rex pane, on the push stream.
- `e3-flight-recorder-long-poll.json`: E3 on the long poll with a page cap of 20. The before for the push stream.
- `e3-flight-recorder-before-page-cap.json`: the first E3 run, before the cap.
- `e3b-recorder-reconnect.json`: E3b on the push stream, the recorder resumes after two cut connections.
- `e3b-recorder-reconnect-long-poll.json`: E3b on the long poll. The before.
- `e4-flight-stream-cost.json`: E4, delivery time of one event with 4,300 and 40,200 rows in the log.
- `e5-access-gate.json`: E5, the gateway refuses 42 of 42 requests with a bad or missing Access token. Local issuer. `environment: local`.
- `p2-customer0-findings.json`: a product finding about account access, not a gateway claim.
- `p1-domain-mutation-check.json`: written by `bun scripts/mutation-check.ts`. 29 of 29 mutations caught.

An `amendments` list in a receipt records a correction made after the run. It never changes a number.
