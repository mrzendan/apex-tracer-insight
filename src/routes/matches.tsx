import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { matches, maps, tournaments } from "@/lib/mock-match";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/matches")({
  component: MatchesPage,
  head: () => ({
    meta: [
      { title: "Матчи — APEX STATS" },
      { name: "description", content: "Все матчи Apex Legends с VOD-аналитикой." },
    ],
  }),
});

function MatchesPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/matches" && pathname !== "/matches/") return <Outlet />;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-surface/80 px-4 backdrop-blur">
        <Link to="/" className="text-sm font-bold tracking-tight">APEX STATS</Link>
        <span className="text-mono text-[10px] text-muted-foreground">/ Матчи</span>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle compact />
        </div>
      </header>
      <div className="mx-auto max-w-7xl p-6">
        <div className="mb-4 flex items-center gap-3">
          <Link to="/" aria-label="Назад" className="flex h-8 w-8 items-center justify-center rounded-sm border border-border-strong bg-surface-2 text-sm hover:bg-muted">←</Link>
          <h1 className="text-xl font-bold">Матчи</h1>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {matches.map((m) => {
            const mp = maps.find((x) => x.id === m.mapId);
            const t = tournaments.find((x) => x.id === m.tournamentId);
            return (
              <Link key={m.id} to="/matches/$matchId" params={{ matchId: m.id }}
                className="hud-panel hover-lift group overflow-hidden">
                {mp?.image && (
                  <div className="relative h-28 overflow-hidden">
                    <img src={mp.image} alt={mp.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                    <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />
                  </div>
                )}
                <div className="p-3">
                  <div className="label-eyebrow text-[9px] text-muted-foreground truncate">{t?.name}</div>
                  <div className="mt-1 text-sm font-semibold leading-tight">{m.name}</div>
                  <div className="text-mono mt-1 text-[10px] text-muted-foreground">{mp?.name} · {Math.round(m.durationSec / 60)} мин</div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}