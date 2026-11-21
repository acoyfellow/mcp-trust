# Receipts

Each file here is evidence for one claim. See `docs/receipt-schema.md`.

- `e1-tool-passport.json`: E1, 50 trials per arm. Name-only resolution and a keyless impostor.
- `e1b-lookalike-provider.json`: E1b, 50 trials per arm. A lookalike provider with its own valid key.
- `e2-write-fence.json`: E2, 20 poisoned cases and 20 clean tasks.
- `e2-write-fence-control.json`: E2 control, 20 poisoned cases with the fence off.
- `p2-customer0-findings.json`: a product finding about account access, not a gateway claim.
- `p1-domain-mutation-check.json`: written by `bun scripts/mutation-check.ts`. 22 of 22 mutations caught.
- E3 has no receipt yet.

An `amendments` list in a receipt records a correction made after the run. It never changes a number.
