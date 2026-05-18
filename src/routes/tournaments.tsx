import { createFileRoute, Link } from "@tanstack/react-router";
import { tournaments, matches, maps } from "@/lib/mock-match";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/tournaments")({
  component: TournamentsPage,
  head: () => ({
    meta: [
      { title: "Турниры — APEX STATS" },
      { name: "description", content: "Все турниры Apex Legends с матчами и картами." },
    ],
  }),
});

function TournamentsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-surface/80 px-4 backdrop-blur">
        <Link to="/" className="text-sm font-bold tracking-tight">APEX STATS</Link>
        <span className="text-mono text-[10px] text-muted-foreground">/ Турниры</span>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle compact />
          <Link to="/" className="rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider hover:bg-muted">← На главную</Link>
        </div>
      </header>
      <div className="mx-auto max-w-7xl p-6">
        <h1 className="mb-4 text-xl font-bold">Турниры</h1>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((t) => {
            const tMatches = matches.filter((m) => m.tournamentId === t.id);
            return (
              <div key={t.id} className="hud-panel p-4">
                <div className="label-eyebrow text-[10px]">{t.region} · {t.type} · Y{t.year}</div>
                <div className="mt-1 text-sm font-semibold">{t.name}</div>
                <div className="text-mono mt-0.5 text-[10px] text-muted-foreground">{t.startDate} → {t.endDate}</div>
                <ul className="mt-3 space-y-1">
                  {tMatches.map((m) => {
                    const mp = maps.find((x) => x.id === m.mapId);
                    return (
                      <li key={m.id}>
                        <Link to="/matches/$matchId" params={{ matchId: m.id }}
                          className="flex items-center justify-between rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-xs hover:border-primary/40 hover:text-primary">
                          <span className="font-semibold">{m.name}</span>
                          <span className="text-muted-foreground">{mp?.name}</span>
                        </Link>
                      </li>
                    );
                  })}
                  {tMatches.length === 0 && <li className="text-[10px] text-muted-foreground">No matches yet</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}