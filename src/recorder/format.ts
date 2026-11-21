export interface FlightRow {
  readonly seq: number;
  readonly at: string;
  readonly session: string;
  readonly kind: "event" | "rejection";
  readonly name: string;
  readonly tool: string | null;
  readonly server: string | null;
  readonly provider: string | null;
  readonly verified: boolean;
  readonly verdict: "n/a" | "allowed" | "blocked";
  readonly rejection: string | null;
}

export interface WireEntry {
  readonly seq: number;
  readonly at: string;
  readonly event: { readonly _tag: string; readonly [field: string]: unknown };
  readonly row: FlightRow;
}

export interface Recorded extends WireEntry {
  readonly session: string;
  readonly source: string;
  readonly receivedAt: number;
  readonly wroteAt: number;
}

const SOURCES: Readonly<Record<string, string>> = {
  ServerRegistered: "ToolRegistry",
  ToolRegistered: "ToolRegistry",
  NameCollided: "ToolRegistry",
  CallRouted: "ToolRegistry",
  TargetsNamed: "WriteFence",
  WriteAllowed: "WriteFence",
  ReadAllowed: "WriteFence",
  RefusalRecorded: "Refusals",
};

export const sourceOf = (tag: string): string => {
  const source = Object.hasOwn(SOURCES, tag) ? SOURCES[tag] : undefined;
  if (source === undefined) throw new Error(`no source known for event ${tag}`);
  return source;
};

export const BANNER = "mcp-trust recording";

export const formatLine = (row: FlightRow): string => {
  const provider =
    row.provider === null ? "-" : `${row.provider}:${row.verified ? "verified" : "unverified"}`;
  return [
    `#${String(row.seq).padStart(5, "0")}`,
    row.at.slice(11, 23),
    row.session,
    row.name,
    `tool=${row.tool ?? "-"}`,
    `provider=${provider}`,
    `fence=${row.verdict}`,
    `reject=${row.rejection ?? "-"}`,
  ].join(" ");
};

const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

export const colorize = (row: FlightRow, line: string, enabled: boolean): string => {
  if (!enabled) return line;
  if (row.kind === "rejection") return `${RED}${line}${RESET}`;
  if (row.verdict === "allowed" || row.name === "CallRouted") return `${GREEN}${line}${RESET}`;
  return `${DIM}${line}${RESET}`;
};
