import { MODEL, type RunRequest, runAgent } from "../src/agent-loop.ts";

interface Env {
  AI: { run: (model: string, input: unknown) => Promise<unknown> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/run" && request.method === "POST") {
      const body = (await request.json()) as RunRequest;
      const result = await runAgent((input) => env.AI.run(MODEL, input), body);
      return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
    }
    return new Response("agent", { status: 404 });
  },
};
