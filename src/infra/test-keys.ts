import { providerKeyFromSecret } from "../domain/passport.ts";

export const ACME_KEY = providerKeyFromSecret("a1".repeat(32));
export const IMPOSTOR_KEY = providerKeyFromSecret("b2".repeat(32));

export const PINNED_KEYS: Readonly<Record<string, string>> = { acme: ACME_KEY.publicKey };
