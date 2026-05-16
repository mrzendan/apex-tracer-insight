import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { maps as allMaps, generateTrajectory } from "@/lib/mock-match";
import { useAdminStore } from "@/lib/admin-store";
import { TeamLogo } from "@/components/admin/TeamLogo";

export const Route = createFileRoute("/admin/maps/$mapId")({ component: MapDetail });

type Mode = "all" | "year" | "tournaments";

function MapDetail() {
  const { mapId } = Route.useParams();
  const { matches, tournaments, teams } = useAdminStore();
  const navigate = useNavigate();
  const map = allMaps.find((m) => m.id === mapId);

  const mapMatches = useMemo(
    () => matches.filter((m) => (m.mapIds ?? [m.mapId]).includes(mapId)),
    [matches, mapId],
  );
  const mapTournaments = useMemo(() => {
    const ids = Array.from(new Set(mapMatches.map((m) => m.tournamentId)));
    return ids.map((id) => tournaments.find((t) => t.id === id)).filter(Boolean) as typeof tournaments;
  }, [mapMatches, tournaments]);

  const allYears = Array.from(new Set(tournaments.map((t) => t.year))).sort((a, b) => b - a);
  const [teamId, setTeamId] = useState<string>(teams[0]?.id ?? "");
  const [mode, setMode] = useState<Mode>("all");
  const [year, setYear] = useState<number>(allYears[0] ?? 6);
  const [selectedTours, setSelectedTours] = useState<string[]>([]);

  if (!map) {
    return (
      <div className="p-6 text-sm">
        Map not found. <Link to="/admin/maps" className="text-primary underline">Back to maps</Link>
      </div>
    );
  }

  const filteredMatches = mapMatches.filter((m) => {
    if (mode === "year") return tournaments.find((t) => t.id === m.tournamentId)?.year === year;
    if (mode === "tournaments") return selectedTours.includes(m.tournamentId);
    return true;
  });

  // Build heatmap: aggregate trajectories of the selected team across filtered matches.
  const GRID = 36;
  const heat = useMemo(() => {
    const cells = new Array(GRID * GRID).fill(0) as number[];
    if (!teamId) return cells;
    filteredMatches.forEach((m, mi) => {
      const seed = (m.id.charCodeAt(m.id.length - 1) + mi * 17 + teamId.charCodeAt(teamId.length - 1) * 31) % 9999;
      const pts = generateTrajectory(seed, m.durationSec);
      pts.forEach((p) => {
        const gx = Math.min(GRID - 1, Math.max(0, Math.floor(p.x * GRID)));
        const gy = Math.min(GRID - 1, Math.max(0, Math.floor(p.y * GRID)));
        cells[gy * GRID + gx] += 1;
      });
    });
    return cells;
  }, [filteredMatches, teamId]);

  const maxHeat = Math.max(1, ...heat);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-6">
        <button onClick={() => navigate({ to: "/admin/maps" })} className="text-mono rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-muted">← Maps</button>
        <h1 className="text-sm font-bold uppercase tracking-wider">{map.name}</h1>
        <span className="text-[10px] text-muted-foreground">{mapMatches.length} matches · {mapTournaments.length} tournaments</span>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <div className="space-y-4">
            <div className="hud-panel overflow-hidden">
              <img src={map.image} alt={map.name} className="aspect-video w-full object-cover" />
              <div className="border-t border-border px-3 py-2 text-xs font-semibold">{map.name}</div>
            </div>

            <div className="hud-panel p-3">
              <div className="label-eyebrow mb-2 text-[10px]">Tournaments used ({mapTournaments.length})</div>
              {mapTournaments.length === 0 ? (
                <div className="rounded-sm border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">No data</div>
              ) : (
                <ul className="space-y-1">
                  {mapTournaments.map((t) => (
                    <li key={t.id} className="rounded-sm border border-border bg-surface px-2 py-1.5 text-xs">
                      <div className="font-semibold">{t.name}</div>
                      <div className="text-[10px] text-muted-foreground">Year {t.year} · {t.region} · {t.type}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="hud-panel p-3">
              <div className="label-eyebrow mb-2 text-[10px]">Heat-map filters</div>
              <div className="space-y-2 text-xs">
                <div>
                  <label className="label-eyebrow text-[10px]">Team</label>
                  <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="mt-1 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-sm">
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.tag} · {t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-eyebrow text-[10px]">Period</label>
                  <div className="mt-1 grid grid-cols-3 gap-1">
                    {(["all", "year", "tournaments"] as Mode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        className={`rounded-sm border px-2 py-1 text-[10px] uppercase tracking-wider ${mode === m ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface hover:bg-muted"}`}
                      >
                        {m === "all" ? "All" : m === "year" ? "Year" : "Tournaments"}
                      </button>
                    ))}
                  </div>
                </div>
                {mode === "year" && (
                  <div>
                    <label className="label-eyebrow text-[10px]">Year</label>
                    <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-sm">
                      {allYears.map((y) => <option key={y} value={y}>Year {y}</option>)}
                    </select>
                  </div>
                )}
                {mode === "tournaments" && (
                  <div className="space-y-1">
                    <label className="label-eyebrow text-[10px]">Tournaments (multi-select)</label>
                    <div className="flex flex-wrap gap-1">
                      {mapTournaments.map((t) => {
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
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground">
                  Sampling {filteredMatches.length} matches
                </div>
              </div>
            </div>
          </div>

          <div className="hud-panel p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="label-eyebrow text-[10px]">Heat-map · {teams.find((t) => t.id === teamId)?.tag ?? "—"}</div>
              <TeamLogo team={teams.find((t) => t.id === teamId) ?? teams[0]} size={20} />
            </div>
            <div className="relative w-full overflow-hidden rounded-sm border border-border bg-surface-2">
              <img src={map.image} alt={map.name} className="block w-full opacity-60" />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                {heat.map((v, i) => {
                  if (v === 0) return null;
                  const gx = i % GRID, gy = Math.floor(i / GRID);
                  const alpha = Math.min(0.85, (v / maxHeat) * 0.9 + 0.05);
                  const color = teams.find((t) => t.id === teamId)?.color ?? "#ff5b12";
                  return (
                    <rect
                      key={i}
                      x={(gx * 100) / GRID}
                      y={(gy * 100) / GRID}
                      width={100 / GRID}
                      height={100 / GRID}
                      fill={color}
                      opacity={alpha}
                    />
                  );
                })}
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}