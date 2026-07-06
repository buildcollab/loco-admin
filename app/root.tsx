import {
  isRouteErrorResponse,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import { cn } from "~/components/ui";
import "./app.css";

export const meta: Route.MetaFunction = () => [
  { title: "loco-admin" },
  {
    name: "description",
    content: "Admin console for Loco applications — background jobs & scheduler.",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen font-sans">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

const NAV = [
  { to: "/", label: "Overview", end: true, icon: IconGauge },
  { to: "/jobs", label: "Background Jobs", end: false, icon: IconQueue },
  { to: "/scheduler", label: "Scheduler", end: false, icon: IconClock },
];

export default function App() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col lg:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="shrink-0 border-b border-slate-200 bg-white/60 px-4 py-4 backdrop-blur lg:w-60 lg:border-b-0 lg:border-r lg:py-6 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-center gap-2 px-2 lg:mb-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          L
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            loco-admin
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            operations console
          </div>
        </div>
      </div>
      <nav className="mt-4 flex gap-1 overflow-x-auto lg:mt-0 lg:flex-col">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition",
                  isActive
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-200"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                )
              }
            >
              <Icon />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let heading = "Something went wrong";
  let detail: string | undefined;

  if (isRouteErrorResponse(error)) {
    heading = `${error.status} ${error.statusText}`;
    detail = typeof error.data === "string" ? error.data : undefined;
  } else if (error instanceof Error) {
    detail = error.message;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
      </div>
      <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
        {heading}
      </h1>
      {detail ? (
        <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
          {detail}
        </p>
      ) : null}
      <a
        href="/"
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
      >
        Back to overview
      </a>
    </main>
  );
}

/* --------------------------------------------------------------- icons */

function IconGauge() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0 3.5-3.5M4 18a8 8 0 1 1 16 0" />
    </svg>
  );
}

function IconQueue() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}
