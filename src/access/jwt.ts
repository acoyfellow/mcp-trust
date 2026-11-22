export interface Jwk {
  readonly kid: string;
  readonly kty: string;
  readonly n: string;
  readonly e: string;
  readonly alg?: string;
}

export interface AccessConfig {
  readonly aud: string;
  readonly teamDomain: string;
  readonly certsUrl?: string | undefined;
}

export class AccessDenied extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const decode = (part: string): Uint8Array<ArrayBuffer> => {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

const json = (part: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(new TextDecoder().decode(decode(part))) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {}
  throw new AccessDenied("malformed token");
};

export const issuerOf = (teamDomain: string): string => `https://${teamDomain}`;

export const certsUrlOf = (config: AccessConfig): string =>
  config.certsUrl ?? `https://${config.teamDomain}/cdn-cgi/access/certs`;

export const verifyAccessJwt = async (
  token: string,
  config: AccessConfig,
  keys: ReadonlyArray<Jwk>,
  now: number = Date.now(),
): Promise<Record<string, unknown>> => {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AccessDenied("malformed token");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = json(headerPart);
  if (header.alg !== "RS256") throw new AccessDenied("unsupported algorithm");
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (jwk === undefined) throw new AccessDenied("unknown signing key");
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decode(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) throw new AccessDenied("bad signature");
  const claims = json(payloadPart);
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(config.aud)) throw new AccessDenied("wrong audience");
  if (claims.iss !== issuerOf(config.teamDomain)) throw new AccessDenied("wrong issuer");
  const seconds = Math.floor(now / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= seconds) throw new AccessDenied("expired");
  if (typeof claims.nbf === "number" && claims.nbf > seconds)
    throw new AccessDenied("not yet valid");
  return claims;
};

interface CertsCache {
  readonly at: number;
  readonly keys: ReadonlyArray<Jwk>;
}

const caches = new Map<string, CertsCache>();
const CERTS_TTL_MS = 5 * 60_000;

export const fetchCerts = async (
  config: AccessConfig,
  fetchFn: typeof fetch = fetch,
  now: number = Date.now(),
  force = false,
): Promise<ReadonlyArray<Jwk>> => {
  const url = certsUrlOf(config);
  const cached = caches.get(url);
  if (!force && cached !== undefined && now - cached.at < CERTS_TTL_MS) return cached.keys;
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`certs answered ${response.status}`);
  const keys = ((await response.json()) as { keys: ReadonlyArray<Jwk> }).keys;
  caches.set(url, { at: now, keys });
  return keys;
};

export const clearCertsCache = () => caches.clear();

export const checkAccess = async (
  headers: Readonly<Record<string, string | undefined>>,
  config: AccessConfig,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const token = headers["cf-access-jwt-assertion"];
  if (token === undefined || token === "") return { ok: false, reason: "no token" };
  try {
    const keys = await fetchCerts(config, fetchFn);
    try {
      await verifyAccessJwt(token, config, keys);
    } catch (error) {
      if (!(error instanceof AccessDenied) || error.reason !== "unknown signing key") throw error;
      await verifyAccessJwt(token, config, await fetchCerts(config, fetchFn, Date.now(), true));
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof AccessDenied ? error.reason : "certs unavailable",
    };
  }
};
