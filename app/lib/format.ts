/**
 * Client-safe formatting helpers. No server-only imports here so these can be
 * used from any component.
 */

export type JobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export const JOB_STATUSES: JobStatus[] = [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
];

interface StatusMeta {
  label: string;
  /** Tailwind classes for a filled badge. Dark-mode aware. */
  badge: string;
  /** A single accent colour used for dots / bars. */
  dot: string;
}

const STATUS_META: Record<JobStatus, StatusMeta> = {
  queued: {
    label: "Queued",
    badge:
      "bg-sky-100 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20",
    dot: "bg-sky-500",
  },
  processing: {
    label: "Processing",
    badge:
      "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20",
    dot: "bg-amber-500",
  },
  completed: {
    label: "Completed",
    badge:
      "bg-emerald-100 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20",
    dot: "bg-emerald-500",
  },
  failed: {
    label: "Failed",
    badge:
      "bg-rose-100 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20",
    dot: "bg-rose-500",
  },
  cancelled: {
    label: "Cancelled",
    badge:
      "bg-slate-200 text-slate-600 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-400/20",
    dot: "bg-slate-400",
  },
};

export function statusMeta(status: string): StatusMeta {
  return (
    STATUS_META[status as JobStatus] ?? {
      label: status,
      badge:
        "bg-slate-200 text-slate-600 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-400/20",
      dot: "bg-slate-400",
    }
  );
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return DATE_FMT.format(d);
}

/** Compact relative time, e.g. "3m ago" or "in 2h". */
export function relativeTime(
  value: string | Date | null | undefined,
  now: number = Date.now(),
): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = d.getTime() - now;
  const future = diffMs > 0;
  const abs = Math.abs(diffMs);

  const units: [number, string][] = [
    [1000, "s"],
    [60 * 1000, "m"],
    [60 * 60 * 1000, "h"],
    [24 * 60 * 60 * 1000, "d"],
  ];

  if (abs < 1000) return "just now";

  let label = "";
  if (abs < 60 * 1000) label = `${Math.round(abs / units[0][0])}s`;
  else if (abs < 60 * 60 * 1000) label = `${Math.round(abs / units[1][0])}m`;
  else if (abs < 24 * 60 * 60 * 1000) label = `${Math.round(abs / units[2][0])}h`;
  else label = `${Math.round(abs / units[3][0])}d`;

  return future ? `in ${label}` : `${label} ago`;
}

/** Human interval from milliseconds, e.g. 3600000 -> "1h". */
export function formatInterval(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  if (ms <= 0) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return trim(s) + "s";
  const m = s / 60;
  if (m < 60) return trim(m) + "m";
  const h = m / 60;
  if (h < 24) return trim(h) + "h";
  const d = h / 24;
  return trim(d) + "d";
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function truncate(value: string, max = 80): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "…";
}

/** Best-effort pretty-print of JSON-ish data. */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function coerceTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}
