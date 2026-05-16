import { createFileRoute, Link } from "@tanstack/react-router";
import { matches, teams, tournaments, maps } from "@/lib/mock-match";

export const Route = createFileRoute("/admin/")({ component: AdminDashboard });

const tools = [
  { to: "/admin/matches",  title: "Matches",  desc: "Upload VODs, link screenshots, manage games" },
  { to: "/admin/hsv",      title: "HSV",      desc: "Calibrate team color masks from frames" },
  { to: "/admin/zones",    title: "Zones",    desc: "Markup HUD areas on a 1920×1080 frame" },
  { to: "/admin/polygons", title: "Polygons", desc: "Draw forbidden / safe map areas" },
  { to: "/admin/camera",   title: "Camera",   desc: "Calibrate observer camera tracking" },
  { to: "/admin/minimap",  title: "Minimap",  desc: "Detect & align minimap to full map" },
] as const;

function AdminDashboard() {
  return (
    <div className="flex h-full flex-col overflow-auto">
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-surface px-6">
        <h1 className="text-sm font-bold uppercase tracking-wider">Dashboard</h1>
        <div className="ml-auto label-eyebrow text-[10px]">Mock data · frontend only</div>
      </header>

      <div className="grid grid-cols-2 gap-3 border-b border-border bg-background px-6 py-4 lg:grid-cols-4">
        <Stat label="Tournaments" value={tournaments.length} />
        <Stat label="Matches"     value={matches.length} />
        <Stat label="Maps"        value={maps.length} />
        <Stat label="Teams"       value={teams.length} />
      </div>

      <div className="flex-1 overflow-auto p-6">
        <h2 className="mb-3 label-eyebrow">Tools</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tools.map((t) => (
            <Link key={t.to} to={t.to}
              className="group hud-panel block p-4 transition-colors hover:border-primary/40 hover:bg-surface-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider">{t.title}</h3>
                <span className="text-mono text-primary opacity-0 transition-opacity group-hover:opacity-100">→</span>
              </div>
              <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{t.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="hud-panel-strong px-4 py-3">
      <div className="label-eyebrow text-[9px]">{label}</div>
      <div className="text-mono mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
