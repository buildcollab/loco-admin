import { createBrowserRouter, isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Layout } from "./Layout";
import { Overview, overviewLoader } from "./pages/Overview";
import { Jobs, jobsLoader } from "./pages/Jobs";
import { JobDetail, jobLoader } from "./pages/JobDetail";
import { Scheduler, schedulerLoader } from "./pages/Scheduler";
import { Servers, serversLoader } from "./pages/Servers";

function RouteError() {
  const error = useRouteError();
  let heading = "Something went wrong";
  let detail: string | undefined;
  if (isRouteErrorResponse(error)) {
    heading = `${error.status} ${error.statusText}`;
    detail = typeof error.data === "string" ? error.data : undefined;
  } else if (error instanceof Error) {
    detail = error.message;
  }
  return (
    <div className="main" style={{ display: "grid", placeItems: "center", minHeight: "70vh", textAlign: "center" }}>
      <div>
        <h1>{heading}</h1>
        {detail ? <p className="muted" style={{ maxWidth: 420 }}>{detail}</p> : null}
        <Link to="/" className="btn primary" style={{ marginTop: 12 }}>Back to overview</Link>
      </div>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, loader: overviewLoader, element: <Overview /> },
      { path: "jobs", loader: jobsLoader, element: <Jobs /> },
      { path: "jobs/:id", loader: jobLoader, element: <JobDetail /> },
      { path: "scheduler", loader: schedulerLoader, element: <Scheduler /> },
      { path: "servers", loader: serversLoader, element: <Servers /> },
    ],
  },
]);
