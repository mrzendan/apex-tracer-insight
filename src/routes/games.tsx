import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { matches, maps, tournaments, matchSeedExtras, getGames } from "@/lib/mock-match";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/games")({
  component: GamesPage,
  head: () => ({
    meta: [
      { title: "Игры — APEX STATS" },
      { name: "description", content: "Все игры (карты) внутри матчей Apex Legends." },
    ],
  }),
});

function GamesPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/games" && pathname !== "/games/") return <Outlet />;
  const mm = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const games = matches.flatMap((m) => {
    const extras = matchSeedExtras[m.id];
    return getGames({ ...m, mapIds: extras?.mapIds, gameDurations: extras?.gameDurations }).map((g) => ({
      g,
      match: m,
      tournament: tournaments.find((t) => t.id === m.tournamentId),
      map: maps.find((x) => x.id === g.mapId),
    }));
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-surface/80 px-4 backdrop-blur">
        <Link to="/" className="text-sm font-bold tracking-tight">APEX STATS</Link>
        <span className="text-mono text-[10px] text-muted-foreground">/ Игры</span>
        <div className="ml-auto"><ThemeToggle compact /></div>
      </header>
      <div className="mx-auto max-w-7xl p-6">
        <div className="mb-4 flex items-center gap-3">
          <Link to="/" aria-label="Назад" className="flex h-8 w-8 items-center justify-center rounded-sm border border-border-strong bg-surface-2 text-sm hover:bg-muted">←</Link>
          <h1 className="text-xl font-bold">Игры</h1>
          <span className="text-mono ml-2 rounded-sm border border-border bg-surface-2 px-2 py-0.5 text-[10px] text-muted-foreground">{games.length}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {games.map(({ g, match, tournament, map }) => (
            <Link key={g.id} to="/games/$gameId" params={{ gameId: g.id }} className="hud-panel hover-lift group overflow-hidden">
              {map?.image && (
                <div className="relative h-28 overflow-hidden">
                  <img src={map.image} alt={map.name} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                  <div className="text-mono absolute left-2 top-2 rounded-sm border border-border-strong bg-surface/90 px-1.5 py-0.5 text-[10px] font-bold">
                    G{g.index + 1}
                  </div>
                  <div className="text-mono absolute right-2 top-2 rounded-sm border border-border-strong bg-surface/90 px-1.5 py-0.5 text-[10px]">
                    {mm(g.durationSec)}
                  </div>
                </div>
              )}
              <div className="p-3">
                <div className="label-eyebrow text-[9px] text-muted-foreground truncate">{tournament?.name}</div>
                <div className="mt-1 text-sm font-semibold leading-tight">{map?.name ?? g.mapId}</div>
                <div className="text-mono mt-1 text-[10px] text-muted-foreground truncate">{match.name}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
