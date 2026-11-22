export type TokenRunner = (app: string) => Promise<string>;

export const cloudflaredToken: TokenRunner = async (app) => {
  const proc = Bun.spawn(["cloudflared", "access", "token", `--app=${app}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  await new Response(proc.stderr).text();
  const token = out.trim();
  if (code !== 0 || token === "") {
    throw new Error(
      `cloudflared could not give a token for ${app}. Run: cloudflared access login ${app}`,
    );
  }
  return token;
};

const TTL_MS = 30 * 60_000;

export const tokenSource = (
  app: string,
  run: TokenRunner = cloudflaredToken,
  now: () => number = Date.now,
) => {
  let cached: { token: string; at: number } | null = null;
  return async (): Promise<string> => {
    if (cached !== null && now() - cached.at < TTL_MS) return cached.token;
    const token = await run(app);
    cached = { token, at: now() };
    return token;
  };
};

export const accessHeaders =
  (source: () => Promise<string>) => async (): Promise<Record<string, string>> => ({
    "cf-access-token": await source(),
  });

export const installAccessFetch = (
  base: string,
  source: () => Promise<string>,
  original: typeof fetch = globalThis.fetch,
): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(base)) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
    headers.set("cf-access-token", await source());
    return original(input, { ...init, headers });
  }) as typeof fetch;
};
