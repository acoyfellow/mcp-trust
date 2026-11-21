import { text, type Json } from "../src/mcp/rpc.ts";
import { ACME_KEY, CLOUDFLARE_KEY } from "../src/infra/test-keys.ts";
import { EXECUTE_TOOL, FILE_TOOLS, originOf, serveUpstream } from "../src/infra/upstream.ts";

interface Env {
  SCRATCH: KVNamespace;
  DECOY: KVNamespace;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const store = (name: unknown) =>
      name === "decoy" ? env.DECOY : name === "scratch" ? env.SCRATCH : null;

    if (url.pathname === "/admin/kv" && request.method === "GET") {
      const ns = store(url.searchParams.get("ns"));
      return json({ value: ns === null ? null : await ns.get(url.searchParams.get("key") ?? "") });
    }
    if (url.pathname === "/admin/kv-list" && request.method === "GET") {
      const ns = store(url.searchParams.get("ns"));
      if (ns === null) return json({ error: "namespace" }, 400);
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await ns.list({ prefix: url.searchParams.get("prefix") ?? "", cursor });
        keys.push(...page.keys.map((k) => k.name));
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor !== undefined);
      return json({ keys });
    }
    if (url.pathname === "/admin/kv" && request.method === "POST") {
      const body = (await request.json()) as { ns: string; key: string; value?: string };
      const ns = store(body.ns);
      if (ns === null) return json({ error: "namespace" }, 400);
      if (body.value === undefined) await ns.delete(body.key);
      else await ns.put(body.key, body.value);
      return json({ ok: true });
    }
    if (url.pathname === "/mcp" && request.method === "POST") {
      const call = async (name: string, args: Record<string, Json>) => {
        if (name === "execute") {
          await env.SCRATCH.put(String(args.key), `acme:${String(args.value)}`);
          return text(`stored ${String(args.key)}`);
        }
        if (name === "read_document") {
          const doc = await env.SCRATCH.get(`doc/${String(args.name)}`);
          return doc === null ? text("document not found", true) : text(doc);
        }
        const ns = store(args.namespace);
        if (ns === null) return text("unknown namespace", true);
        if (name === "kv_put") {
          await ns.put(String(args.key), String(args.value));
          return text(`wrote ${String(args.namespace)}:${String(args.key)}`);
        }
        if (name === "kv_delete") {
          await ns.delete(String(args.key));
          return text(`deleted ${String(args.namespace)}:${String(args.key)}`);
        }
        return text(`unknown tool ${name}`, true);
      };
      const reply = await serveUpstream(
        {
          serverName: "acme",
          identity: { provider: "acme", secretKey: ACME_KEY.secretKey },
          tools: [EXECUTE_TOOL, ...FILE_TOOLS],
          call,
        },
        originOf(Object.fromEntries(request.headers)),
        await request.json(),
      );
      return reply === null ? new Response(null, { status: 202 }) : json(reply);
    }
    if (url.pathname === "/mcp/cloudflare" && request.method === "POST") {
      const reply = await serveUpstream(
        {
          serverName: "cloudflare",
          identity: { provider: "cloudflare", secretKey: CLOUDFLARE_KEY.secretKey },
          mountPath: "/mcp/cloudflare",
          tools: [EXECUTE_TOOL],
          call: async (name, args) => {
            if (name !== "execute") return text(`unknown tool ${name}`, true);
            await env.SCRATCH.put(String(args.key), `cloudflare:${String(args.value)}`);
            return text(`stored ${String(args.key)}`);
          },
        },
        originOf(Object.fromEntries(request.headers)),
        await request.json(),
      );
      return reply === null ? new Response(null, { status: 202 }) : json(reply);
    }
    return new Response("acme", { status: 404 });
  },
};
