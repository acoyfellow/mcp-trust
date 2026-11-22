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
  readonly source: string;
  readonly event: { readonly _tag: string; readonly [field: string]: unknown };
  readonly row: FlightRow;
}

export interface Recorded extends WireEntry {
  readonly session: string;
  readonly source: string;
  readonly receivedAt: number;
  readonly wroteAt: number;
}

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

export type Tone = "red" | "green" | "yellow" | "dim";

const CODES: Readonly<Record<Tone, string>> = {
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  dim: "\u001b[2m",
};
const RESET = "\u001b[0m";

export const colorize = (tone: Tone, line: string, enabled: boolean): string =>
  enabled ? `${CODES[tone]}${line}${RESET}` : line;

export interface Shown {
  readonly tone: Tone;
  readonly full: string;
  readonly compact: string | null;
}

export const COMPACT_WIDTH = 60;

const clock = (row: FlightRow) => row.at.slice(11, 19);

const fit = (head: string, tail: string): string => {
  const room = COMPACT_WIDTH - 10 - 3 - tail.length;
  const tailKeep = 8;
  const shown =
    head.length <= room
      ? head
      : room > tailKeep + 2
        ? `${head.slice(0, room - tailKeep - 1)}…${head.slice(-tailKeep)}`
        : `${head.slice(0, Math.max(1, room - 1))}…`;
  return `${shown}   ${tail}`;
};

const text = (event: WireEntry["event"], key: string): string | null => {
  const value = event[key];
  return typeof value === "string" ? value : null;
};

export class Classifier {
  private readonly collisions = new Map<string, ReadonlyArray<string>>();

  show(entry: WireEntry): Shown {
    const { row, event } = entry;
    const full = formatLine(row);
    const line = (head: string, tail: string) => `${clock(row)}  ${fit(head, tail)}`;
    if (event._tag === "NameCollided") {
      const others = Array.isArray(event.otherProviders) ? (event.otherProviders as string[]) : [];
      const own = text(event, "provider");
      this.collisions.set(
        `${row.session}|${text(event, "tool")}`,
        own === null ? others : [own, ...others],
      );
      return { tone: "dim", full, compact: null };
    }
    if (row.kind === "rejection") {
      const target = text(event, "target");
      const head =
        row.rejection === "ProviderNotNamed" && row.provider !== null
          ? `${row.provider}__${row.tool}`
          : `${row.tool ?? "-"}${target === null ? "" : ` ${target}`}`;
      return { tone: "red", full, compact: line(head, `BLOCKED ${row.rejection ?? "-"}`) };
    }
    if (event._tag === "WriteAllowed") {
      const target = text(event, "target");
      return {
        tone: "green",
        full,
        compact: line(`${row.tool ?? "-"}${target === null ? "" : ` ${target}`}`, "ALLOWED"),
      };
    }
    if (event._tag === "CallRouted") {
      const group = this.collisions.get(`${row.session}|${row.tool}`);
      if (group !== undefined && event.pinned === false && row.provider !== null) {
        const provider = row.provider;
        const lookalike = group.some((other) => other !== provider && provider.startsWith(other));
        return {
          tone: "yellow",
          full,
          compact: `${clock(row)}  REACHED ${lookalike ? "lookalike " : ""}${provider} (unpinned)`,
        };
      }
      return {
        tone: "green",
        full,
        compact: group === undefined ? null : line(`${row.provider}__${row.tool}`, "ROUTED"),
      };
    }
    return { tone: "dim", full, compact: null };
  }
}
