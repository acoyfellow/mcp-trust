import { beforeAll, expect, test } from "bun:test";
import {
  type AccessConfig,
  AccessDenied,
  checkAccess,
  clearCertsCache,
  type Jwk,
  verifyAccessJwt,
} from "../src/access/jwt.ts";

const config: AccessConfig = {
  aud: "aud-123",
  teamDomain: "team.example.test",
  certsUrl: "http://certs.local/keys",
};

const b64 = (bytes: ArrayBuffer | string): string => {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

const makeKey = async (kid: string) => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return { privateKey: pair.privateKey, jwk: { kid, kty: "RSA", n: jwk.n, e: jwk.e } as Jwk };
};

let keyA: Awaited<ReturnType<typeof makeKey>>;
let keyB: Awaited<ReturnType<typeof makeKey>>;
beforeAll(async () => {
  keyA = await makeKey("a");
  keyB = await makeKey("b");
});

const sign = async (
  key: Awaited<ReturnType<typeof makeKey>>,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
) => {
  const head = b64(JSON.stringify({ alg: "RS256", kid: key.jwk.kid, ...header }));
  const body = b64(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64(signature)}`;
};

const good = () => ({
  aud: [config.aud],
  iss: `https://${config.teamDomain}`,
  exp: Math.floor(Date.now() / 1000) + 600,
});

const reason = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof AccessDenied ? error.reason : "other";
  }
  return "accepted";
};

test("a token signed by a listed key with the right audience, issuer and expiry is accepted", async () => {
  const token = await sign(keyA, good());
  const claims = await verifyAccessJwt(token, config, [keyA.jwk]);
  expect(claims.aud).toEqual([config.aud]);
});

test("a token with the wrong audience is refused", async () => {
  const token = await sign(keyA, { ...good(), aud: ["other"] });
  expect(await reason(verifyAccessJwt(token, config, [keyA.jwk]))).toBe("wrong audience");
});

test("a token with the wrong issuer is refused", async () => {
  const token = await sign(keyA, { ...good(), iss: "https://evil.example.test" });
  expect(await reason(verifyAccessJwt(token, config, [keyA.jwk]))).toBe("wrong issuer");
});

test("an expired token is refused, and a token with no expiry is refused", async () => {
  const old = await sign(keyA, { ...good(), exp: Math.floor(Date.now() / 1000) - 5 });
  expect(await reason(verifyAccessJwt(old, config, [keyA.jwk]))).toBe("expired");
  const { exp: _exp, ...noExp } = good();
  expect(await reason(verifyAccessJwt(await sign(keyA, noExp), config, [keyA.jwk]))).toBe(
    "expired",
  );
});

test("a token signed by a key that is not listed is refused", async () => {
  const token = await sign(keyB, good());
  expect(await reason(verifyAccessJwt(token, config, [keyA.jwk]))).toBe("unknown signing key");
});

test("a token with a forged signature under a listed key id is refused", async () => {
  const forged = await sign(keyB, good(), { kid: "a" });
  expect(await reason(verifyAccessJwt(forged, config, [keyA.jwk]))).toBe("bad signature");
});

test("a token with a changed payload is refused", async () => {
  const token = await sign(keyA, good());
  const [h, , s] = token.split(".") as [string, string, string];
  const payload = b64(JSON.stringify({ ...good(), aud: [config.aud], extra: 1 }));
  expect(await reason(verifyAccessJwt(`${h}.${payload}.${s}`, config, [keyA.jwk]))).toBe(
    "bad signature",
  );
});

test("alg none and malformed tokens are refused", async () => {
  const none = `${b64(JSON.stringify({ alg: "none", kid: "a" }))}.${b64(JSON.stringify(good()))}.`;
  expect(await reason(verifyAccessJwt(none, config, [keyA.jwk]))).toBe("unsupported algorithm");
  expect(await reason(verifyAccessJwt("not-a-token", config, [keyA.jwk]))).toBe("malformed token");
});

const serveCerts = (keys: ReadonlyArray<Jwk>, counter: { n: number }) =>
  Bun.serve({
    port: 0,
    fetch: () => {
      counter.n++;
      return Response.json({ keys });
    },
  });

test("checkAccess answers no token, then accepts a valid header, reading the certs over HTTP", async () => {
  clearCertsCache();
  const counter = { n: 0 };
  const server = serveCerts([keyA.jwk], counter);
  const cfg = { ...config, certsUrl: `http://127.0.0.1:${server.port}/keys` };
  try {
    expect(await checkAccess({}, cfg)).toEqual({ ok: false, reason: "no token" });
    const token = await sign(keyA, good());
    expect(await checkAccess({ "cf-access-jwt-assertion": token }, cfg)).toEqual({ ok: true });
    expect(await checkAccess({ "cf-access-jwt-assertion": token }, cfg)).toEqual({ ok: true });
    expect(counter.n).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("checkAccess refreshes the certs once when the key id is new, and refuses when certs are down", async () => {
  clearCertsCache();
  const counter = { n: 0 };
  const keys: Jwk[] = [keyA.jwk];
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      counter.n++;
      return Response.json({ keys });
    },
  });
  const cfg = { ...config, certsUrl: `http://127.0.0.1:${server.port}/keys` };
  try {
    const first = await sign(keyA, good());
    expect((await checkAccess({ "cf-access-jwt-assertion": first }, cfg)).ok).toBe(true);
    keys.push(keyB.jwk);
    const second = await sign(keyB, good());
    expect((await checkAccess({ "cf-access-jwt-assertion": second }, cfg)).ok).toBe(true);
    expect(counter.n).toBe(2);
  } finally {
    server.stop(true);
  }
  clearCertsCache();
  const down = await checkAccess(
    { "cf-access-jwt-assertion": await sign(keyA, good()) },
    { ...config, certsUrl: "http://127.0.0.1:1/keys" },
  );
  expect(down).toEqual({ ok: false, reason: "certs unavailable" });
});

import { accessHeaders, installAccessFetch, tokenSource } from "../src/access/token.ts";

test("the token source runs cloudflared once, caches the token, and asks again after the time to live", async () => {
  let calls = 0;
  let clock = 0;
  const source = tokenSource(
    "https://app.example.test",
    async (app) => {
      calls++;
      expect(app).toBe("https://app.example.test");
      return `token-${calls}`;
    },
    () => clock,
  );
  expect(await source()).toBe("token-1");
  expect(await source()).toBe("token-1");
  clock += 31 * 60_000;
  expect(await source()).toBe("token-2");
  expect(calls).toBe(2);
  expect(await accessHeaders(source)()).toEqual({ "cf-access-token": "token-2" });
});

test("installAccessFetch adds the token only to requests for the protected base", async () => {
  const seen: Array<{ url: string; token: string | null }> = [];
  const original = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: String(input),
      token: new Headers(init?.headers).get("cf-access-token"),
    });
    return new Response("ok");
  }) as typeof fetch;
  const saved = globalThis.fetch;
  try {
    installAccessFetch("https://protected.example.test", async () => "t-1", original);
    await fetch("https://protected.example.test/admin/flight");
    await fetch("https://elsewhere.example.test/x");
  } finally {
    globalThis.fetch = saved;
  }
  expect(seen).toEqual([
    { url: "https://protected.example.test/admin/flight", token: "t-1" },
    { url: "https://elsewhere.example.test/x", token: null },
  ]);
});
