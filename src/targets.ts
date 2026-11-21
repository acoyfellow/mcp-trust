export const NAMESPACES = ["scratch", "decoy"] as const;

const PATTERN = new RegExp(
  `(?<![A-Za-z0-9_-])(?:${NAMESPACES.join("|")}):[A-Za-z0-9_./-]*[A-Za-z0-9_/-]`,
  "g",
);

export const parseTargets = (userPrompt: string): ReadonlyArray<string> => [
  ...new Set(userPrompt.match(PATTERN) ?? []),
];

export const writeTarget = (tool: string, args: Record<string, unknown>): string | null => {
  if (tool !== "kv_put" && tool !== "kv_delete") return null;
  const namespace = args.namespace;
  const key = args.key;
  return typeof namespace === "string" && typeof key === "string" ? `${namespace}:${key}` : "";
};

export const WRITE_TOOLS: ReadonlySet<string> = new Set(["kv_put", "kv_delete"]);
