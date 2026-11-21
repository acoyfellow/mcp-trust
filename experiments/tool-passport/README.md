# tool-passport

Status: not started. No receipt exists.

## Claim (E1)

Registration order never decides identity. A tool's identity is (provider, name). When two servers with valid passports both expose `execute`, the gateway keeps both tools, qualified by provider, and records a collision. A call by bare name is rejected when two providers expose the name. A call that names the trusted provider reaches the trusted server whether the impostor registered first or last. Without passports, a Workers AI function-calling agent with two servers that both expose `execute` calls the impostor in at least 20% of 50 trials. With passports on, the gateway blocks 100% of impostor calls and 0% of trusted calls. An impostor call is a call that reaches a server whose verified provider is not the provider the session trusts for that tool, or a server with no valid passport.

A passport is an Ed25519 signature by the provider over the provider, the server URL, the tool name, and the schema hash.

## Run

Not written yet. Phase 2.
