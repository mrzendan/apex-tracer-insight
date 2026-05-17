import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { matches, maps, teams, tournaments } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";

export const Route = createFileRoute("/teams/$teamId")({
  component: TeamPage,
  loader: ({ params }) => {
    const t = teams.find((x) => x.id === params.teamId);
    if (!t) throw notFound();
    return t;
  },
  notFoundComponent: () => (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-background text-foreground">
      <h1 className="text-lg font-bold">Team not found</h1>
      <Link to="/" className="text-xs text-primary hover:underline">← Back to hub</Link>
    </div>
  ),
});

function TeamPage() {
  const { teamId } = Route.useParams();
  const team = teams.find((t) => t.id === teamId)!;
  const teamMatches = matches.filter((m) => (m as { teamIds?: string[] }).teamIds?.includes(teamId) ?? true);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center gap-4 border-b border-border bg-surface px-4">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M12 3 L21 20 H3 Z" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight">APEX STATS</div>
            <div className="label-eyebrow text-[9px]">VOD analytics</div>
          </div>
        </Link>
        <nav className="text-mono ml-4 text-xs text-muted-foreground">
          <Link to="/" className="hover:text-primary">Hub</Link>
          <span className="mx-1">/</span>
          <span className="text-foreground">Teams</span>
          <span className="mx-1">/</span>
          <span className="text-foreground">{team.tag}</span>
        </nav>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <section className="hud-panel flex items-center gap-5 p-5" style={{ borderColor: team.color }}>
          <TeamLogo team={team} size={72} />
          <div className="flex-1">
            <div className="text-mono text-[10px] uppercase tracking-wider" style={{ color: team.color }}>{team.tag}</div>
            <h1 className="text-2xl font-bold">{team.name}</h1>
            <div className="mt-1 text-xs text-muted-foreground">
              Placement #{team.placement} · {team.kills} kills · {team.alive ? "alive" : "eliminated"}
            </div>
          </div>
        </section>

        <section className="hud-panel p-4">
          <h2 className="label-eyebrow mb-3">Roster</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {team.players.map((p) => (
              <li key={p} className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm font-semibold">{p}</li>
            ))}
          </ul>
        </section>

        <section className="hud-panel p-4">
          <h2 className="label-eyebrow mb-3">Matches</h2>
          <ul className="space-y-1.5">
            {teamMatches.map((m) => {
              const mp = maps.find((x) => x.id === m.mapId);
              const t = tournaments.find((x) => x.id === m.tournamentId);
              return (
                <li key={m.id}>
                  <Link
                    to="/matches/$matchId"
                    params={{ matchId: m.id }}
                    className="flex items-center justify-between rounded-sm border border-border bg-surface px-3 py-2 text-xs hover:border-primary/40 hover:bg-surface-2"
                  >
                    <span className="font-semibold">{m.name}</span>
                    <span className="text-muted-foreground">{mp?.name} · {t?.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
