# Contributing

This notebook accepts changes that add or correct evidence.

## Run the checks

```sh
bun install
bun test
bun run typecheck
bun run lint
```

## Rules

- Write a domain story before you change a domain rule. A rule that no story covers does not belong in the model.
- Move a claim to `proven` in `status.json` only with a linked receipt.
- Move a claim to `disproven` only with a `verified-disproved` receipt.
- Do not change a test so that a failing claim passes. Record the failure.
- Do not use mocks, stubbed HTTP, or invented numbers in an experiment.
- Write docs in short sentences. Use active voice. Do not use hype.
- Do not add comments to `.sh` or `.swift` files.
