import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAdminStore } from "@/lib/admin-store";
import { maps as allMaps } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";

export const Route = createFileRoute("/admin/teams/$teamId")({ component: TeamDetail });

type Mode = "all" | "year" | "tournaments";

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

  const allYears = Array.from(new Set(tournaments.map((t) => t.year))).sort((a, b) => b - a);
  const [mode, setMode] = useState<Mode>("all");
  const [year, setYear] = useState<number>(allYears[0] ?? 6);
  const [selectedTours, setSelectedTours] = useState<string[]>([]);

  const filteredMatches = useMemo(() => {
    if (mode === "year") return teamMatches.filter((m) => tournaments.find((t) => t.id === m.tournamentId)?.year === year);
    if (mode === "tournaments") return teamMatches.filter((m) => selectedTours.includes(m.tournamentId));
    return teamMatches;
  }, [teamMatches, mode, year, selectedTours, tournaments]);

  // Map tier list. Compute score per map: matches played × (1/avg placement proxy).
  // We don't have per-match placement, so use team.placement as a baseline plus a
  // map-frequency weighting to differentiate.
  const mapStats = useMemo(() => {
    const counts = new Map<string, number>();
    filteredMatches.forEach((m) => {
      (m.mapIds ?? [m.mapId]).forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
    });
    const entries = Array.from(counts.entries()).map(([id, count]) => {
      const map = allMaps.find((mp) => mp.id === id);
      const score = count * (1 / Math.max(1, team.placement));
      return { id, map, count, score };
    });
    entries.sort((a, b) => b.score - a.score);
    return entries;
  }, [filteredMatches, team.placement]);

  const maxScore = Math.max(0.0001, ...mapStats.map((s) => s.score));
  const tier = (s: number): "S" | "A" | "B" | "C" | "D" => {
    const r = s / maxScore;
    if (r > 0.8) return "S";
    if (r > 0.6) return "A";
    if (r > 0.4) return "B";
    if (r > 0.2) return "C";
    return "D";
  };
  const tierColor = (t: string) =>
    t === "S" ? "bg-destructive/20 text-destructive border-destructive/40"
    : t === "A" ? "bg-primary/20 text-primary border-primary/40"
    : t === "B" ? "bg-accent/20 text-accent border-accent/40"
    : t === "C" ? "bg-muted text-foreground/80 border-border"
    : "bg-surface-2 text-muted-foreground border-border";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-6">
        <button onClick={() => navigate({ to: "/admin/teams" })} className="text-mono rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-muted">← Teams</button>
        <TeamLogo team={team} size={28} />
        <h1 className="text-sm font-bold uppercase tracking-wider">{team.tag} · {team.name}</h1>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <div className="hud-panel mb-4 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="label-eyebrow text-[10px]">Period</div>
            {(["all", "year", "tournaments"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-sm border px-2 py-1 text-[10px] uppercase tracking-wider ${mode === m ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface hover:bg-muted"}`}
              >
                {m === "all" ? "All time" : m === "year" ? "By year" : "By tournaments"}
              </button>
            ))}
            {mode === "year" && (
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-sm border border-border bg-background px-2 py-1 text-xs">
                {allYears.map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            )}
            {mode === "tournaments" && (
              <div className="flex flex-wrap gap-1">
                {teamTournaments.map((t) => {
                  const on = selectedTours.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTours(on ? selectedTours.filter((x) => x !== t.id) : [...selectedTours, t.id])}
                      className={`rounded-sm border px-1.5 py-0.5 text-[10px] ${on ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface hover:bg-muted"}`}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground">{filteredMatches.length} matches in period</span>
          </div>
        </div>

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
            {filteredMatches.length === 0 ? <Empty /> : (
              <ul className="space-y-1">
                {filteredMatches.map((m) => {
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

        <div className="hud-panel mt-4 p-3">
          <div className="label-eyebrow mb-3 text-[10px]">Map tier list · best placements</div>
          {mapStats.length === 0 ? <Empty /> : (
            <div className="space-y-2">
              {(["S", "A", "B", "C", "D"] as const).map((row) => {
                const items = mapStats.filter((s) => tier(s.score) === row);
                if (items.length === 0) return null;
                return (
                  <div key={row} className="flex items-stretch gap-2">
                    <div className={`flex w-12 shrink-0 items-center justify-center rounded-sm border text-lg font-bold ${tierColor(row)}`}>{row}</div>
                    <div className="flex flex-1 flex-wrap gap-2 rounded-sm border border-border bg-surface p-2">
                      {items.map((s) => (
                        <Link
                          key={s.id}
                          to={"/admin/maps/$mapId" as "/admin/maps"}
                          params={{ mapId: s.id } as never}
                          className="flex items-center gap-2 rounded-sm border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
                        >
                          {s.map && <img src={s.map.image} alt={s.map.name} className="h-8 w-12 rounded-sm object-cover" />}
                          <div>
                            <div className="text-xs font-semibold">{s.map?.name ?? s.id}</div>
                            <div className="text-mono text-[10px] text-muted-foreground">{s.count} games</div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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