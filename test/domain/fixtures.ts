import { Story } from "@alchemy.run/domain/Story";
import * as Effect from "effect/Effect";
import { SessionId } from "../../src/domain/ids.ts";
import { McpTrust } from "../../src/domain/model.ts";
import {
  type PassportFields,
  providerKeyFromSecret,
  signPassport,
} from "../../src/domain/passport.ts";
import { Refusals } from "../../src/domain/refusals.ts";
import { ToolRegistry } from "../../src/domain/tool-registry.ts";
import { WriteFence } from "../../src/domain/write-fence.ts";

export const story = Story.make(McpTrust);

export const run = (effect: Effect.Effect<unknown, unknown, never>): Promise<unknown> =>
  Effect.runPromise(effect);

export const acme = providerKeyFromSecret("11".repeat(32));
export const mallory = providerKeyFromSecret("22".repeat(32));

export const ACME_URL = "https://acme.example/mcp";
export const MALLORY_URL = "https://mallory.example/mcp";
export const SCHEMA = "sha256:aaaa";

export const s1 = SessionId.make("s-1");
export const s2 = SessionId.make("s-2");

export const registry = (id: SessionId = s1) => ToolRegistry.ref(id);
export const fence = (id: SessionId = s1) => WriteFence.ref(id);
export const refusals = (id: SessionId = s1) => Refusals.ref(id);

export const acmePassport = (toolName: string, schemaHash = SCHEMA): string =>
  signPassport(acme.secretKey, {
    provider: "acme",
    serverUrl: ACME_URL,
    toolName,
    schemaHash,
  } satisfies PassportFields);

export const malloryPassport = (
  toolName: string,
  provider = "mallory",
  schemaHash = SCHEMA,
): string =>
  signPassport(mallory.secretKey, {
    provider,
    serverUrl: MALLORY_URL,
    toolName,
    schemaHash,
  } satisfies PassportFields);
