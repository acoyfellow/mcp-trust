import { sseEntries } from "../../src/recorder/record.ts";
import { gitInfo, type Receipt, writeReceipt } from "../lib/common.ts";
import { withStack } from "../lib/stack.ts";

const AUD = "e5-local-audience";
const TEAM = "e5-local-team.test";
const OFFICIAL = process.env.E5_SMOKE === undefined;

const b64 = (bytes: ArrayBuffer | string): string => {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

const keyPair = async (kid: string) => {
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
  return { kid, privateKey: pair.privateKey, jwk: { kid, kty: "RSA", n: jwk.n, e: jwk.e } };
};

const main = async () => {
  const startedAt = new Date().toISOString();
  const trusted = await keyPair("trusted");
  const stranger = await keyPair("stranger");
  const certs = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => Response.json({ keys: [trusted.jwk] }),
  });
  process.env.ACCESS_AUD = AUD;
  process.env.ACCESS_TEAM_DOMAIN = TEAM;
  process.env.ACCESS_CERTS_URL = `http://127.0.0.1:${certs.port}/keys`;

  const sign = async (
    key: Awaited<ReturnType<typeof keyPair>>,
    claims: Record<string, unknown>,
    kid = key.kid,
  ) => {
    const head = b64(JSON.stringify({ alg: "RS256", kid }));
    const body = b64(JSON.stringify(claims));
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    );
    return `${head}.${body}.${b64(signature)}`;
  };
  const claims = (over: Record<string, unknown> = {}) => ({
    aud: [AUD],
    iss: `https://${TEAM}`,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...over,
  });

  try {
    await withStack(async (urls) => {
      const tokens: Array<[string, string | null]> = [
        ["no token", null],
        ["garbage", "not-a-token"],
        ["wrong audience", await sign(trusted, claims({ aud: ["other"] }))],
        ["wrong issuer", await sign(trusted, claims({ iss: "https://other.test" }))],
        ["expired", await sign(trusted, claims({ exp: Math.floor(Date.now() / 1000) - 10 }))],
        ["signed by a key the team does not list", await sign(stranger, claims())],
        ["forged key id", await sign(stranger, claims(), "trusted")],
      ];
      const valid = await sign(trusted, claims());
      const routes: Array<{ name: string; method: string; path: string; body?: unknown }> = [
        { name: "admin: head", method: "GET", path: "/admin/flight/head" },
        { name: "admin: flight rows", method: "GET", path: "/admin/flight" },
        { name: "admin: stream", method: "GET", path: "/admin/flight/stream?after=0" },
        {
          name: "admin: configure a session",
          method: "POST",
          path: "/admin/sessions/e5-s",
          body: { mode: "passports", fence: true, userPrompt: "x", upstreams: [] },
        },
        {
          name: "mcp: tools/list",
          method: "POST",
          path: "/mcp/e5-s",
          body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        },
        { name: "an unknown path", method: "GET", path: "/nothing-here" },
      ];
      const attempt = async (
        route: (typeof routes)[number],
        token: string | null,
      ): Promise<number> => {
        const controller = new AbortController();
        const response = await fetch(`${urls.gatewayUrl}${route.path}`, {
          method: route.method,
          signal: controller.signal,
          headers: {
            ...(route.body === undefined ? {} : { "content-type": "application/json" }),
            ...(token === null ? {} : { "cf-access-jwt-assertion": token }),
          },
          ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }),
        });
        const status = response.status;
        controller.abort();
        return status;
      };

      const refused: Array<{ route: string; token: string; status: number }> = [];
      for (const route of routes) {
        for (const [label, token] of tokens) {
          refused.push({ route: route.name, token: label, status: await attempt(route, token) });
        }
      }
      const accepted: Array<{ route: string; status: number }> = [];
      for (const route of routes) {
        accepted.push({ route: route.name, status: await attempt(route, valid) });
      }

      const streamResponse = await fetch(`${urls.gatewayUrl}/admin/flight/stream?after=0`, {
        headers: { "cf-access-jwt-assertion": valid },
      });
      let streamedEvents = 0;
      const reader = (async () => {
        for await (const _entry of sseEntries(streamResponse.body as ReadableStream<Uint8Array>)) {
          streamedEvents++;
          if (streamedEvents >= 1) return;
        }
      })();
      await Promise.race([reader, Bun.sleep(8000)]);

      const parts = {
        everyRefusalWas403: refused.every((r) => r.status === 403),
        everyRouteRefusedAllSevenBadTokens: refused.length === routes.length * tokens.length,
        validTokenReachedEveryRouteExceptUnknownPath: accepted
          .filter((a) => a.route !== "an unknown path")
          .every((a) => a.status === 200),
        unknownPathWithValidTokenIsNotForbidden: accepted
          .filter((a) => a.route === "an unknown path")
          .every((a) => a.status === 404),
        streamDeliveredAnEventWithAValidToken: streamedEvents >= 1,
      };
      const verdict: Receipt["verdict"] = Object.values(parts).every(Boolean)
        ? "verified"
        : "verified-disproved";
      const receipt: Receipt = {
        schema: "mcp-trust/receipt/v1",
        experiment: "access-gate",
        claimId: "E5-access-gate",
        verdict,
        intent:
          "The gateway Worker refuses every route with 403 unless the Cf-Access-Jwt-Assertion header holds a token that is signed by a key in the team's certs, has the app's audience and issuer, and has not expired. Seven bad tokens on six routes: 42 requests, all 403. A valid token gets 200 on every route (404 for a path that does not exist).",
        environment: "local",
        execution: {
          command: "bun experiments/access/run.ts",
          startedAt,
          endedAt: new Date().toISOString(),
          ...gitInfo(),
          how: "The gateway runs under alchemy dev with ACCESS_AUD, ACCESS_TEAM_DOMAIN and ACCESS_CERTS_URL set. The harness is the issuer: it generates two RSA keys, serves one of them as the team's certs on a local port, and signs the tokens with WebCrypto. The Worker fetches those certs over HTTP and verifies the signatures with WebCrypto, the same code that runs when the certs URL is the team's.",
          passCriteria: parts,
        },
        evidence: {
          observed: { refused, accepted, streamedEvents },
          projected: {
            note: "This tests the Worker's check. It does not test Cloudflare Access itself. The issuer is local, with a made-up audience and team name. The check against the real app (audience dce994f3...) and the real team certs happens on the deployed Worker, and is not run yet. A token is checked when a request starts: an open stream is not cut when its token expires.",
            notProven: [
              "That the real team certs and the real app audience verify. This needs the deployed Worker.",
              "That Access itself stops a request with no token before the Worker. This needs the deployed hostname.",
              "`cloudflared access token` as the source of the token: the helper is unit-tested with a stand-in runner, and the real binary is not run.",
            ],
          },
          realized: {},
        },
        constraintCleared: [
          {
            constraint: "Real signature verification, not a bypass",
            met: true,
            how: "Tokens signed with RSA-SHA256 by WebCrypto; a forged key id and a stranger's key are refused.",
          },
        ],
        cost: { workersAiCalls: 0, neurons: 0 },
      };
      if (OFFICIAL) writeReceipt("receipts/e5-access-gate.json", receipt);
      else await Bun.write("/tmp/e5-smoke.json", JSON.stringify(receipt, null, 2));
      console.log(
        JSON.stringify(
          {
            verdict,
            parts,
            nonForbidden: refused.filter((r) => r.status !== 403),
            accepted,
            streamedEvents,
          },
          null,
          2,
        ),
      );
    });
  } finally {
    certs.stop(true);
  }
};

await main();
