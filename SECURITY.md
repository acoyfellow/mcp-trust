# Security

This repository is an experiment notebook. It is not a product. Do not rely on it to protect real systems.

## Report a problem

Open a private report with the repository owner. Do not post exploit details in a public issue.

## Scope

- The gateway code is experimental. It has no deployment and no access control yet.
- Tests write to two scratch KV namespaces, `mcp-trust-scratch` and `mcp-trust-decoy`. Tests never touch other account resources.
- Tests never call `mcp.cloudflare.com` with real credentials.
- Provider keys in tests are fixed test keys. They protect nothing.

## What the notebook does not claim

- A passport proves that a provider signed a tool description. It does not prove that the tool is safe.
- The write fence checks write targets. It does not stop reads, and it does not stop an agent from writing wrong data to a target the user named.
- The provider public key must come from the operator, never from the upstream server. If a server supplies its own key, the passport check proves nothing.
