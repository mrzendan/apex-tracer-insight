import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAdminStore } from "@/lib/admin-store";
import { maps as allMaps, type MatchFull } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";

export const Route = createFileRoute("/admin/teams/$teamId")({ component: TeamDetail });

type Mode = "all" | "year" | "tournaments";

/** Deterministic per-match date derived from tournament window + match index. */
function matchDateTime(match: MatchFull, tourStart?: string, tourEnd?: string, indexInTour = 0) {
  if (!tourStart) return null;
  const start = new Date(tourStart + "T18:00:00Z").getTime();
  const end = tourEnd ? new Date(tourEnd + "T22:00:00Z").getTime() : start + 86400000;
  const span = Math.max(86400000, end - start);
  // 6 games per day stagger; spread across tournament window deterministically.
  const offset = (indexInTour * 75 * 60_000) % span; // 75 min between games
  return new Date(start + offset);
}
function fmtDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" });
}
function fmtTime(d: Date | null) {
  if (!d) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

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
  const tourIndex = new Map(tournaments.map((t) => [t.id, t]));
  const today = Date.now();

  // Annotate matches with derived datetime and per-tournament index.
  type Row = { match: MatchFull; tour: ReturnType<typeof tourIndex.get>; date: Date | null };
  const tourCounters = new Map<string, number>();
  const allRows: Row[] = matches.map((m) => {
    const idx = tourCounters.get(m.tournamentId) ?? 0;
    tourCounters.set(m.tournamentId, idx + 1);
    const tour = tourIndex.get(m.tournamentId);
    return { match: m, tour, date: matchDateTime(m, tour?.startDate, tour?.endDate, idx) };
  });
  const teamRows = allRows.filter((r) => r.match.teamIds?.includes(team.id));
  const teamTournaments = useMemo(() => {
    const ids = Array.from(new Set(teamRows.map((r) => r.match.tournamentId)));
    return ids.map((id) => tourIndex.get(id)).filter(Boolean) as typeof tournaments;
  }, [teamRows]);

  const nextRows = teamRows
    .filter((r) => r.date && r.date.getTime() >= today)
    .sort((a, b) => (a.date!.getTime() - b.date!.getTime()));

  const allYears = Array.from(new Set(tournaments.map((t) => t.year))).sort((a, b) => b - a);
  const [mode, setMode] = useState<Mode>("all");
  const [year, setYear] = useState<number>(allYears[0] ?? 6);
  const [selectedTours, setSelectedTours] = useState<string[]>([]);

  const filteredRows = useMemo(() => {
    if (mode === "year") return teamRows.filter((r) => r.tour?.year === year);
    if (mode === "tournaments") return teamRows.filter((r) => selectedTours.includes(r.match.tournamentId));
    return teamRows;
  }, [teamRows, mode, year, selectedTours]);

  const filteredTournaments = useMemo(() => {
    if (mode === "year") return teamTournaments.filter((t) => t.year === year);
    if (mode === "tournaments") return teamTournaments.filter((t) => selectedTours.includes(t.id));
    return teamTournaments;
  }, [teamTournaments, mode, year, selectedTours]);

  // Per-map deterministic placement sampler (1..20) — stable per (mapId, matchId, teamId).
  function pseudoPlacement(mapId: string, matchId: string): number {
    let h = team.placement * 7;
    const s = mapId + matchId + team.id;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 1 + (h % 20);
  }

  // Per-map stats over filtered window
  type MapStat = { id: string; count: number; avg: number; top1: number; top5: number };
  const mapStats = useMemo<MapStat[]>(() => {
    const acc = new Map<string, { sum: number; count: number; top1: number; top5: number }>();
    filteredRows.forEach((r) => {
      const ids = r.match.mapIds ?? [r.match.mapId];
      ids.forEach((id) => {
        const p = pseudoPlacement(id, r.match.id);
        const cur = acc.get(id) ?? { sum: 0, count: 0, top1: 0, top5: 0 };
        cur.sum += p;
        cur.count += 1;
        if (p === 1) cur.top1 += 1;
        if (p <= 5) cur.top5 += 1;
        acc.set(id, cur);
      });
    });
    return Array.from(acc.entries())
      .map(([id, v]) => ({ id, count: v.count, avg: v.sum / v.count, top1: v.top1, top5: v.top5 }))
      .sort((a, b) => a.avg - b.avg);
  }, [filteredRows]);

  // Tier from average placement (lower is better).
  const tierOf = (avg: number): "S" | "A" | "B" | "C" | "D" | "F" => {
    if (avg <= 3) return "S";
    if (avg <= 6) return "A";
    if (avg <= 9) return "B";
    if (avg <= 12) return "C";
    if (avg <= 16) return "D";
    return "F";
  };
  const tierColor = (t: string) =>
    t === "S" ? "bg-destructive/20 text-destructive border-destructive/40"
    : t === "A" ? "bg-primary/20 text-primary border-primary/40"
    : t === "B" ? "bg-accent/20 text-accent border-accent/40"
    : t === "C" ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
    : t === "D" ? "bg-muted text-foreground/80 border-border"
    : "bg-surface-2 text-muted-foreground border-border";

  const tourStatus = (t: { startDate: string; endDate: string }) => {
    const s = new Date(t.startDate + "T00:00:00Z").getTime();
    const e = new Date(t.endDate + "T23:59:59Z").getTime();
    if (today < s) return { label: "FUTURE", cls: "bg-accent/15 text-accent border-accent/30" };
    if (today > e) return { label: "PAST", cls: "bg-surface-2 text-muted-foreground border-border" };
    return { label: "LIVE", cls: "bg-destructive/20 text-destructive border-destructive/40 animate-pulse" };
  };

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
            <span className="ml-auto text-[10px] text-muted-foreground">{filteredRows.length} matches in period</span>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Panel title={`Next matches (${nextRows.length})`}>
            {nextRows.length === 0 ? <Empty /> : (
              <ScrollList>
                {nextRows.map((r) => (
                  <li key={r.match.id}>
                    <Link
                      to={"/admin/matches/$matchId" as "/admin/matches"}
                      params={{ matchId: r.match.id } as never}
                      className="block rounded-sm border border-border bg-surface px-2 py-1.5 text-xs hover:bg-muted"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold">{r.match.name}</span>
                        <span className="text-mono text-[10px] text-muted-foreground whitespace-nowrap">
                          {fmtDate(r.date)} · {fmtTime(r.date)}
                        </span>
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">{r.tour?.name}</div>
                    </Link>
                  </li>
                ))}
              </ScrollList>
            )}
          </Panel>

          <Panel title={`Tournaments (${filteredTournaments.length})`}>
            {filteredTournaments.length === 0 ? <Empty /> : (
              <ScrollList>
                {filteredTournaments.map((t) => {
                  const st = tourStatus(t);
                  return (
                    <li key={t.id}>
                      <Link
                        to="/admin/tournaments"
                        className="block rounded-sm border border-border bg-surface px-2 py-1.5 text-xs hover:bg-muted"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold">{t.name}</span>
                          <span className={`rounded-sm border px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wider ${st.cls}`}>{st.label}</span>
                        </div>
                        <div className="text-mono text-[10px] text-muted-foreground">
                          {t.startDate} → {t.endDate} · {t.region}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ScrollList>
            )}
          </Panel>

          <Panel title={`Matches (${filteredRows.length})`}>
            {filteredRows.length === 0 ? <Empty /> : (
              <ScrollList>
                {filteredRows.map((r) => {
                  const map = allMaps.find((mp) => mp.id === r.match.mapId);
                  return (
                    <li key={r.match.id}>
                      <Link
                        to={"/admin/matches/$matchId" as "/admin/matches"}
                        params={{ matchId: r.match.id } as never}
                        className="block rounded-sm border border-border bg-surface px-2 py-1.5 text-xs hover:bg-muted"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold">{r.match.name}</span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{map?.name}</span>
                        </div>
                        <div className="text-mono text-[10px] text-muted-foreground">{fmtDate(r.date)} · {fmtTime(r.date)}</div>
                      </Link>
                    </li>
                  );
                })}
              </ScrollList>
            )}
          </Panel>
        </div>

        <div className="hud-panel mt-4 p-3">
          <div className="label-eyebrow mb-3 text-[10px]">Map tier list · avg placement, top 1 & top 5</div>
          {mapStats.length === 0 ? <Empty /> : (
            <div className="space-y-2">
              {(["S", "A", "B", "C", "D", "F"] as const).map((row) => {
                const items = mapStats.filter((s) => tierOf(s.avg) === row);
                if (items.length === 0) return null;
                return (
                  <div key={row} className="flex items-stretch gap-2">
                    <div className={`flex w-14 shrink-0 items-center justify-center rounded-sm border text-2xl font-bold ${tierColor(row)}`}>{row}</div>
                    <div className="flex flex-1 flex-wrap gap-2 rounded-sm border border-border bg-surface p-2">
                      {items.map((s) => {
                        const map = allMaps.find((mp) => mp.id === s.id);
                        return (
                          <Link
                            key={s.id}
                            to={"/admin/maps/$mapId" as "/admin/maps"}
                            params={{ mapId: s.id } as never}
                            search={{ team: team.id } as never}
                            className="flex w-[220px] items-center gap-3 rounded-sm border border-border bg-background p-2 hover:bg-muted"
                          >
                            {map && <img src={map.image} alt={map.name} className="h-16 w-24 rounded-sm object-cover" />}
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{map?.name ?? s.id}</div>
                              <div className="text-mono text-[10px] text-muted-foreground">{s.count} games</div>
                              <div className="text-mono mt-1 text-[10px]">
                                <span className="text-foreground">avg #{s.avg.toFixed(1)}</span>
                                <span className="ml-2 text-destructive">T1×{s.top1}</span>
                                <span className="ml-2 text-primary">T5×{s.top5}</span>
                              </div>
                            </div>
                          </Link>
                        );
                      })}
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
function ScrollList({ children }: { children: React.ReactNode }) {
  return <ul className="max-h-[320px] space-y-1 overflow-y-auto pr-1">{children}</ul>;
}
function Empty() {
  return <div className="rounded-sm border border-dashed border-border px-2 py-4 text-center text-xs text-muted-foreground">No data</div>;
}
