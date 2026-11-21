# The domain model

The model is in `src/domain/`. It is the spec. The stories in `test/domain/` run it.

## Aggregates

`ToolRegistry` is one per agent session. It decides which server owns each tool name.

| Command | Events | Rejections |
| --- | --- | --- |
| `RegisterServer` | `ServerRegistered` | `ServerAlreadyRegistered` |
| `RegisterTool` | `ToolRegistered` | `UnverifiedPassport`, `NameCollision` |
| `RouteCall` | `CallRouted` | `Misbinding` |

`WriteFence` is one per agent session. It decides which write targets the agent may use.

| Command | Events | Rejections |
| --- | --- | --- |
| `NameTargets` | `TargetsNamed` | none |
| `RequestWrite` | `WriteAllowed` | `TargetNotNamed`, `TargetsNotDeclared` |

`Refusals` is one per agent session. It records each rejection as an event, so that `FlightLog` can show it.

| Command | Events | Rejections |
| --- | --- | --- |
| `RecordRefusal` | `RefusalRecorded` | none |

## View

`FlightLog` has one key for all sessions. It holds one entry for each event and each recorded refusal.

## Rules

1. A server id registers once. A second registration with the same id is refused, so nobody can swap a key.
2. A tool registers only if its passport verifies against the key pinned for its server.
3. A passport covers the provider, the server URL, the tool name, and the schema hash. A change to any of them breaks it.
4. A tool name belongs to one server. A different server cannot take it.
5. A call routes only to the server that owns the tool name.
6. A write passes only if the target is in the set named by the user. Matching is exact.
7. A write before the user names targets is refused as undeclared.
8. A later user turn adds targets. It does not remove earlier ones.

## Assumptions

- The public key in `RegisterServer` comes from the operator. The gateway looks it up by provider name in its own configuration. The upstream server never supplies it.
- Only the gateway sends `NameTargets`, and only with targets parsed from the user prompt. Tool results never reach this command.
- Only the gateway sends `RecordRefusal`, after it receives a rejection.

## Passport format

The message is `JSON.stringify([provider, serverUrl, toolName, schemaHash])` in UTF-8. The signature is Ed25519 in lowercase hex. The check runs inside `decide`, with `@noble/curves`, because `decide` must stay pure and synchronous.
