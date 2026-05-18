import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { teams } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/teams")({
  component: TeamsPage,
  head: () => ({
    meta: [
      { title: "Команды — APEX STATS" },
      { name: "description", content: "Все команды и их статистика в Apex Legends." },
    ],
  }),
});

function TeamsPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/teams" && pathname !== "/teams/") return <Outlet />;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-surface/80 px-4 backdrop-blur">
        <Link to="/" className="text-sm font-bold tracking-tight">APEX STATS</Link>
        <span className="text-mono text-[10px] text-muted-foreground">/ Команды</span>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle compact />
          <Link to="/" className="rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider hover:bg-muted">← На главную</Link>
        </div>
      </header>
      <div className="mx-auto max-w-7xl p-6">
        <h1 className="mb-4 text-xl font-bold">Команды</h1>
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {[...teams].sort((a, b) => a.placement - b.placement).map((team) => (
            <Link key={team.id} to="/teams/$teamId" params={{ teamId: team.id }}
              className="hud-panel flex items-center gap-2.5 px-3 py-2 transition hover:border-primary/40">
              <TeamLogo team={team} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold">{team.name}</div>
                <div className="text-mono text-[10px] text-muted-foreground">{team.tag} · #{team.placement}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}