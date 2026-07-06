import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("jobs", "routes/jobs.tsx"),
  route("jobs/:id", "routes/job-detail.tsx"),
  route("scheduler", "routes/scheduler.tsx"),
  route("servers", "routes/servers.tsx"),
] satisfies RouteConfig;
