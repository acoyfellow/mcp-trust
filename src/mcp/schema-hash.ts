import type { Json } from "./rpc.ts";

const canonical = (value: Json): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, Json>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
};

export const schemaHash = async (tool: {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Json;
}): Promise<string> => {
  const bytes = new TextEncoder().encode(
    canonical({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}`;
};
