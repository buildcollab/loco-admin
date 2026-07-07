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

export function statusLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

export function formatDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : DATE_FMT.format(d);
}

export function relativeTime(
  v: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 1000) return "just now";
  let label: string;
  if (abs < 60_000) label = `${Math.round(abs / 1000)}s`;
  else if (abs < 3_600_000) label = `${Math.round(abs / 60_000)}m`;
  else if (abs < 86_400_000) label = `${Math.round(abs / 3_600_000)}h`;
  else label = `${Math.round(abs / 86_400_000)}d`;
  return diff > 0 ? `in ${label}` : `${label} ago`;
}

export function formatInterval(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const s = ms / 1000;
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  if (s < 60) return `${trim(s)}s`;
  const m = s / 60;
  if (m < 60) return `${trim(m)}m`;
  const h = m / 60;
  if (h < 24) return `${trim(h)}h`;
  return `${trim(h / 24)}d`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatMetricValue(v: number | null): string {
  if (v == null) return "—"; // non-finite serialised as null
  if (Number.isInteger(v)) return formatNumber(v);
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function truncate(s: string, max = 26): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
