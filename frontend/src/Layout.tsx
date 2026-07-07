import { NavLink, Outlet } from "react-router";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/jobs", label: "Background Jobs", end: false },
  { to: "/scheduler", label: "Scheduler", end: false },
  { to: "/servers", label: "Servers", end: false },
];

export function Layout() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">L</div>
          <div>
            <div style={{ fontWeight: 600 }}>loco-admin</div>
            <small>operations console</small>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
