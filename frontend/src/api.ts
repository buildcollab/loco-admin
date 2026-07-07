// Thin client for the Loco backend JSON APIs. In dev, rsbuild proxies /api to
// the Loco server; in production the SPA is served by Loco so /api is same-origin.

export interface Job {
  id: string;
  name: string;
  task_data: unknown;
  status: string;
  run_at: string;
  interval: number | null;
  created_at: string;
  updated_at: string;
  tags: string[];
}

export interface JobPage {
  rows: Job[];
  total: number;
  page: number;
  page_size: number;
  page_count: number;
}

export interface JobStats {
  total: number;
  by_status: Record<string, number>;
  due_now: number;
  recurring: number;
}

export interface Facets {
  names: string[];
  tags: string[];
}

export interface ScheduledJob {
  name: string;
  run: string;
  shell: boolean;
  run_on_start: boolean;
  schedule: string;
  tags: string[];
  next_runs: string[];
  is_english: boolean;
  parse_error: string | null;
}

export interface SchedulerData {
  path: string;
  exists: boolean;
  error: string | null;
  jobs: ScheduledJob[];
  recent: Job[];
}

export interface Probe {
  key: string;
  path: string;
  ok: boolean;
  status: number;
  latency_ms: number | null;
  error: string | null;
}

export interface PromSample {
  labels: Record<string, string>;
  value: number | null;
}

export interface PromFamily {
  name: string;
  type: string | null;
  help: string | null;
  samples: PromSample[];
}

export interface ServerMetrics {
  server: {
    id: string;
    name: string;
    base_url: string;
    tags: string[];
    metrics_path: string | null;
    source: string;
  };
  status: "up" | "degraded" | "down";
  latency_ms: number | null;
  probes: Probe[];
  server_info: {
    ok: boolean;
    not_found: boolean;
    error: string | null;
    info: Record<string, unknown> | null;
  };
  metrics: {
    ok: boolean;
    path: string;
    not_found: boolean;
    error: string | null;
    families: PromFamily[];
    sample_count: number;
  };
  uptime_seconds: number | null;
}

export interface ServersData {
  servers: ServerMetrics[];
  resolver_error: string | null;
  configured: boolean;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Response(detail || `Request failed (${res.status})`, {
      status: res.status,
    });
  }
  return res.json() as Promise<T>;
}

export const api = {
  jobs: (qs: string) => getJson<JobPage>(`/api/jobs?${qs}`),
  jobStats: () => getJson<JobStats>("/api/jobs/stats"),
  facets: () => getJson<Facets>("/api/jobs/facets"),
  job: (id: string) => getJson<Job>(`/api/jobs/${encodeURIComponent(id)}`),
  scheduler: () => getJson<SchedulerData>("/api/scheduler"),
  servers: () => getJson<ServersData>("/api/servers"),
  action: async (body: {
    intent: string;
    ids?: string[];
    status?: string;
  }): Promise<{ ok: boolean; affected: number; message: string }> => {
    const res = await fetch("/api/jobs/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  },
};
