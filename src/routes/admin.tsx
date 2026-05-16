import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

const navItems = [
  { to: "/admin",          label: "Dashboard",   exact: true,  hint: "Overview" },
  { to: "/admin/matches",  label: "Matches",     hint: "Tournaments & games" },
  { to: "/admin/hsv",      label: "HSV",         hint: "Team color calibration" },
  { to: "/admin/zones",    label: "Zones",       hint: "HUD areas (1920×1080)" },
  { to: "/admin/polygons", label: "Polygons",    hint: "Map areas" },
  { to: "/admin/camera",   label: "Camera",      hint: "Camera tracking" },
  { to: "/admin/minimap",  label: "Minimap",     hint: "Minimap detection" },
] as const;

function AdminLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-surface">
        <Link to="/" className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M12 3 L21 20 H3 Z" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight">APEX STATS</div>
            <div className="label-eyebrow text-[9px]">Admin console</div>
          </div>
        </Link>
        <nav className="flex-1 overflow-y-auto p-2">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact ?? false }}
              activeProps={{ className: "bg-primary/15 text-primary border-primary/30" }}
              inactiveProps={{ className: "text-foreground/80 hover:bg-muted border-transparent" }}
              className="mb-0.5 block rounded-sm border px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
            >
              <div>{item.label}</div>
              <div className="mt-0.5 text-[10px] font-normal normal-case tracking-normal text-muted-foreground">{item.hint}</div>
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <Link to="/" className="text-mono block rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-center text-[10px] uppercase tracking-wider hover:bg-muted">
            ← Match Viewer
          </Link>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
