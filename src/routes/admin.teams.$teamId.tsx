import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAdminStore } from "@/lib/admin-store";
import { maps as allMaps } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";

export const Route = createFileRoute("/admin/teams/$teamId")({ component: TeamDetail });

function TeamDetail() {
  const { teamId } = Route.useParams();
  const { teams, matches, tournaments } = useAdminStore();
  const navigate = useNavigate();
  const team = teams.find((t) => t.id === teamId);
  if (!team) {
    return (
      <div className="p-6 text-sm">
        Team not found. <Link to="/admin/teams" className="text-primary underline">Back to teams</Link>
      </div>
    );
  }
  const teamMatches = matches.filter((m) => m.teamIds?.includes(team.id));
  const teamTournamentIds = Array.from(new Set(teamMatches.map((m) => m.tournamentId)));
  const teamTournaments = teamTournamentIds.map((id) => tournaments.find((t) => t.id === id)).filter(Boolean) as typeof tournaments;

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = teamTournaments
    .filter((t) => t.startDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const nextMatch = upcoming ? teamMatches.find((m) => m.tournamentId === upcoming.id) : teamMatches[0];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-6">
        <button onClick={() => navigate({ to: "/admin/teams" })} className="text-mono rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-muted">← Teams</button>
        <TeamLogo team={team} size={28} />
        <h1 className="text-sm font-bold uppercase tracking-wider">{team.tag} · {team.name}</h1>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Panel title="Next match">
            {nextMatch ? (
              <Link
                to={"/admin/matches/$matchId" as "/admin/matches"}
                params={{ matchId: nextMatch.id } as never}
                className="block rounded-sm border border-border bg-surface p-3 hover:bg-muted"
              >
                <div className="text-xs font-semibold">{nextMatch.name}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {tournaments.find((t) => t.id === nextMatch.tournamentId)?.name}
                </div>
              </Link>
            ) : <Empty />}
          </Panel>

          <Panel title={`Tournaments (${teamTournaments.length})`}>
            {teamTournaments.length === 0 ? <Empty /> : (
              <ul className="space-y-1">
                {teamTournaments.map((t) => (
                  <li key={t.id}>
                    <Link
                      to="/admin/tournaments"
                      className="block rounded-sm border border-border bg-surface px-2 py-1.5 text-xs hover:bg-muted"
                    >
                      <span className="font-semibold">{t.name}</span>
                      <span className="ml-2 text-[10px] text-muted-foreground">Year {t.year} · {t.region}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Matches (${teamMatches.length})`}>
            {teamMatches.length === 0 ? <Empty /> : (
              <ul className="space-y-1">
                {teamMatches.map((m) => {
                  const map = allMaps.find((mp) => mp.id === m.mapId);
                  return (
                    <li key={m.id}>
                      <Link
                        to={"/admin/matches/$matchId" as "/admin/matches"}
                        params={{ matchId: m.id } as never}
                        className="flex items-center justify-between rounded-sm border border-border bg-surface px-2 py-1.5 text-xs hover:bg-muted"
                      >
                        <span className="font-semibold">{m.name}</span>
                        <span className="text-[10px] text-muted-foreground">{map?.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="hud-panel p-3">
      <div className="label-eyebrow mb-2 text-[10px]">{title}</div>
      {children}
    </div>
  );
}
function Empty() {
  return <div className="rounded-sm border border-dashed border-border px-2 py-4 text-center text-xs text-muted-foreground">No data</div>;
}