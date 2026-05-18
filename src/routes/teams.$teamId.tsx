import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAdminStore } from "@/lib/admin-store";
import { maps as allMaps, type MatchFull } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

export const Route = createFileRoute("/teams/$teamId")({
  component: TeamPage,
  loader: ({ params }) => {
    // Validate against static seed; live data comes from the store.
    const ok = params.teamId.startsWith("t-");
    if (!ok) throw notFound();
    return null;
  },
  notFoundComponent: () => (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-background text-foreground">
      <h1 className="text-lg font-bold">Team not found</h1>
      <Link to="/" className="text-xs text-primary hover:underline">← Back to hub</Link>
    </div>
  ),
});

type Mode = "all" | "year" | "tournaments";

function matchDateTime(match: MatchFull, tourStart?: string, tourEnd?: string, indexInTour = 0) {
  if (!tourStart) return null;
  const start = new Date(tourStart + "T18:00:00Z").getTime();
  const end = tourEnd ? new Date(tourEnd + "T22:00:00Z").getTime() : start + 86400000;
  const span = Math.max(86400000, end - start);
  const offset = (indexInTour * 75 * 60_000) % span;
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

function TeamPage() {
  const { teamId } = Route.useParams();
  const { teams, matches, tournaments } = useAdminStore();
  const navigate = useNavigate();
  const team = teams.find((t) => t.id === teamId);
  if (!team) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-background text-foreground">
        <h1 className="text-lg font-bold">Team not found</h1>
        <Link to="/" className="text-xs text-primary hover:underline">← Back to hub</Link>
      </div>
    );
  }

  const tourIndex = new Map(tournaments.map((t) => [t.id, t]));
  const today = Date.now();

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
    .sort((a, b) => a.date!.getTime() - b.date!.getTime());

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

  function pseudoPlacement(mapId: string, matchId: string): number {
    let h = team!.placement * 7;
    const s = mapId + matchId + team!.id;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 1 + (h % 20);
  }

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
    : t === "B" ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/50"
    : t === "C" ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
    : t === "D" ? "bg-muted text-foreground/80 border-border"
    : "bg-surface-2 text-muted-foreground border-border";

  const tourStatus = (t: { startDate: string; endDate: string }) => {
    const s = new Date(t.startDate + "T00:00:00Z").getTime();
    const e = new Date(t.endDate + "T23:59:59Z").getTime();
    if (today < s) return { label: "FUTURE", cls: "bg-success/20 text-success border-success/40" };
    if (today > e) return { label: "PAST", cls: "bg-surface-2 text-muted-foreground border-border" };
    return { label: "LIVE", cls: "bg-destructive/20 text-destructive border-destructive/40 animate-pulse" };
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-6">
        <button onClick={() => navigate({ to: "/" })} className="text-mono rounded-sm border border-border bg-surface-2 px-2 py-1 text-xs uppercase tracking-wider hover:bg-muted">← Hub</button>
        <TeamLogo team={team} size={28} />
        <h1 className="text-sm font-bold uppercase tracking-wider">{team.tag} · {team.name}</h1>
      </header>
      <div className="p-6">
        <div className="hud-panel mb-4 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="label-eyebrow text-xs">Period</div>
            <button
              onClick={() => setMode("all")}
              className={`rounded-sm border px-2 py-1 text-xs uppercase tracking-wider ${mode === "all" ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface hover:bg-muted"}`}
            >
              All time
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={`rounded-sm border px-2 py-1 text-xs uppercase tracking-wider ${mode === "year" ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface hover:bg-muted"}`}
                >
                  By year{mode === "year" ? ` · ${year}` : ""} ▾
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-40 p-1">
                {allYears.map((y) => (
                  <button
                    key={y}
                    onClick={() => { setMode("year"); setYear(y); }}
                    className={`block w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted ${mode === "year" && year === y ? "bg-primary/10 text-primary" : ""}`}
                  >
                    Year {y}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={`rounded-sm border px-2 py-1 text-xs uppercase tracking-wider ${mode === "tournaments" ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface hover:bg-muted"}`}
                >
                  By tournaments{mode === "tournaments" && selectedTours.length ? ` · ${selectedTours.length}` : ""} ▾
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="max-h-80 w-72 overflow-auto p-1">
                <div className="flex items-center justify-between px-2 py-1 text-xs text-muted-foreground">
                  <span>{selectedTours.length} selected</span>
                  <button onClick={() => setSelectedTours([])} className="hover:text-foreground">Clear</button>
                </div>
                {teamTournaments.map((t) => {
                  const on = selectedTours.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        setMode("tournaments");
                        setSelectedTours(on ? selectedTours.filter((x) => x !== t.id) : [...selectedTours, t.id]);
                      }}
                      className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted ${on ? "bg-primary/10 text-primary" : ""}`}
                    >
                      <span className={`inline-block h-3 w-3 shrink-0 rounded-sm border ${on ? "border-primary bg-primary" : "border-border"}`} />
                      <span className="truncate">{t.name}</span>
                    </button>
                  );
                })}
                {teamTournaments.length === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">No tournaments</div>
                )}
              </PopoverContent>
            </Popover>
            <span className="ml-auto text-xs text-muted-foreground">{filteredRows.length} matches in period</span>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Panel title={`Next matches (${nextRows.length})`}>
            {nextRows.length === 0 ? <Empty /> : (
              <ScrollList>
                {nextRows.map((r) => (
                  <li key={r.match.id}>
                    <Link
                      to="/matches/$matchId"
                      params={{ matchId: r.match.id }}
                      className="block rounded-sm border border-border bg-surface px-2 py-1.5 text-xs hover:bg-muted"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold">{r.match.name}</span>
                        <span className="text-mono text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(r.date)} · {fmtTime(r.date)}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{r.tour?.name}</div>
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
                    <li key={t.id} className="block rounded-sm border border-border bg-surface px-2 py-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold">{t.name}</span>
                        <span className={`rounded-sm border px-1.5 py-[1px] text-xs font-bold uppercase tracking-wider ${st.cls}`}>{st.label}</span>
                      </div>
                      <div className="text-mono text-xs text-muted-foreground">
                        {t.startDate} → {t.endDate} · {t.region}
                      </div>
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
                        to="/matches/$matchId"
                        params={{ matchId: r.match.id }}
                        className="block rounded-sm border border-border bg-surface px-2 py-1.5 text-xs hover:bg-muted"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold">{r.match.name}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{map?.name}</span>
                        </div>
                        <div className="text-mono text-xs text-muted-foreground">{fmtDate(r.date)} · {fmtTime(r.date)}</div>
                      </Link>
                    </li>
                  );
                })}
              </ScrollList>
            )}
          </Panel>
        </div>

        <div className="hud-panel mt-4 p-3">
          <div className="label-eyebrow mb-3 text-xs">Map tier list · avg placement, top 1 & top 5</div>
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
                          <div
                            key={s.id}
                            className="flex w-[320px] items-center gap-3 rounded-sm border border-border bg-background p-2"
                          >
                            {map && <img src={map.image} alt={map.name} className="h-20 w-32 rounded-sm object-cover" />}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-base font-semibold">{map?.name ?? s.id}</div>
                              <div className="text-mono text-xs text-muted-foreground">{s.count} games · avg <span className="text-foreground font-semibold">#{s.avg.toFixed(1)}</span></div>
                              <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                                <span className="inline-flex items-center gap-1 rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-semibold text-warning" title="Победы">
                                  TOP 1 {s.top1}
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-semibold text-primary" title="Топ-5 финиши">
                                  TOP 5 {s.top5}
                                </span>
                              </div>
                            </div>
                          </div>
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
      <div className="label-eyebrow mb-2 text-xs">{title}</div>
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