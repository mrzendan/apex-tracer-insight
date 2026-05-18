import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  tournaments,
  maps,
  matches,
  teams,
  generateTrajectory,
  ringPhases,
  events,
  type Team,
  type RingPhase,
  type GameEvent,
} from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";
import { getSlotColor } from "@/lib/team-colors";

function formatTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

type EventFilter = "all" | "fights" | "rings" | "eliminations" | "rotations" | "errors";

const EVENT_FILTERS: { id: EventFilter; label: string }[] = [
  { id: "all",          label: "Все" },
  { id: "fights",       label: "Бои" },
  { id: "rings",        label: "Кольца" },
  { id: "eliminations", label: "Выбывания" },
  { id: "rotations",    label: "Ротации" },
  { id: "errors",       label: "Спорные" },
];

function matchesFilter(e: GameEvent, f: EventFilter) {
  if (f === "all") return true;
  if (f === "fights")       return e.type === "kill" || e.type === "knock";
  if (f === "rings")        return e.type === "ring";
  if (f === "eliminations") return e.type === "wipe";
  if (f === "rotations")    return e.type === "care";
  if (f === "errors")       return false;
  return true;
}

/** Split each ring phase into CD (waiting) and Closing windows. */
const RING_CLOSE_FRACTION = 0.4;
type RingSegment = { phaseIndex: number; kind: "CD" | "Closing"; startSec: number; endSec: number };
const ringSegments: RingSegment[] = ringPhases.flatMap((p, i) => {
  const dur = p.endSec - p.startSec;
  const closeStart = p.startSec + dur * (1 - RING_CLOSE_FRACTION);
  return [
    { phaseIndex: i, kind: "CD",      startSec: p.startSec, endSec: closeStart } as RingSegment,
    { phaseIndex: i, kind: "Closing", startSec: closeStart, endSec: p.endSec }    as RingSegment,
  ];
});

export function MatchViewer({ initialMatchId }: { initialMatchId?: string }) {
  const firstId = initialMatchId ?? matches[0].id;
  const initialMatch = matches.find((m) => m.id === firstId) ?? matches[0];
  const [tournamentId, setTournamentId] = useState(initialMatch.tournamentId);
  const [matchId, setMatchId] = useState(initialMatch.id);
  const match = matches.find((m) => m.id === matchId) ?? matches[0];
  const apexMap = maps.find((m) => m.id === match.mapId)!;

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(
    () => new Set(teams.map((t) => t.id)),
  );
  const [hoverTeam, setHoverTeam] = useState<string | null>(null);
  const [showTrails, setShowTrails] = useState(true);
  const [showRing, setShowRing] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [focusRequest, setFocusRequest] = useState<{ x: number; y: number; token: number } | null>(null);
  const [cfg, setCfg] = useState({
    trailWidth: 2,
    labelSize: 22,
    labelBg: 0.78,
    dwellWindow: 40,    // seconds
    dwellRadius: 0.04,  // normalized
  });

  const trajectories = useMemo(
    () => Object.fromEntries(teams.map((t, i) => [t.id, generateTrajectory(i + 7, match.durationSec)])),
    [match.durationSec],
  );

  /** Detect dwell clusters per team: contiguous windows of >= dwellWindow seconds
   *  where all points stay within dwellRadius of the window's mean position. */
  const dwellsByTeam = useMemo(() => {
    const out: Record<string, { x: number; y: number; tStart: number; tEnd: number }[]> = {};
    for (const team of teams) {
      const pts = trajectories[team.id];
      if (!pts) { out[team.id] = []; continue; }
      const dwells: { x: number; y: number; tStart: number; tEnd: number }[] = [];
      let i = 0;
      while (i < pts.length) {
        let sumX = pts[i].x, sumY = pts[i].y;
        let j = i + 1;
        while (j < pts.length) {
          const n = j - i + 1;
          const mx = (sumX + pts[j].x) / n;
          const my = (sumY + pts[j].y) / n;
          let ok = true;
          for (let k = i; k <= j; k++) {
            const dx = pts[k].x - mx, dy = pts[k].y - my;
            if (dx * dx + dy * dy > cfg.dwellRadius * cfg.dwellRadius) { ok = false; break; }
          }
          if (!ok) break;
          sumX += pts[j].x; sumY += pts[j].y;
          j++;
        }
        const last = j - 1;
        const dur = pts[last].t - pts[i].t;
        if (dur >= cfg.dwellWindow) {
          const n = last - i + 1;
          let ax = 0, ay = 0;
          for (let k = i; k <= last; k++) { ax += pts[k].x; ay += pts[k].y; }
          dwells.push({ x: ax / n, y: ay / n, tStart: pts[i].t, tEnd: pts[last].t });
          i = last + 1;
        } else {
          i++;
        }
      }
      out[team.id] = dwells;
    }
    return out;
  }, [trajectories, cfg.dwellWindow, cfg.dwellRadius]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const nt = t + dt * speed;
        if (nt >= match.durationSec) { setPlaying(false); return match.durationSec; }
        return nt;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, match.durationSec]);

  const ring = useMemo<RingPhase>(() => {
    const cur = ringPhases.find((p) => time >= p.startSec && time <= p.endSec) ?? ringPhases[ringPhases.length - 1];
    const next = ringPhases[ringPhases.indexOf(cur) + 1];
    if (!next) return cur;
    const k = Math.max(0, Math.min(1, (time - cur.startSec) / (cur.endSec - cur.startSec)));
    return { ...cur, cx: cur.cx + (next.cx - cur.cx) * k, cy: cur.cy + (next.cy - cur.cy) * k, r: cur.r + (next.r - cur.r) * k };
  }, [time]);

  const toggleTeam = (id: string) => {
    setSelectedTeams((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const aliveTeams = teams.filter((t) => t.alive).length;
  const totalKills = teams.reduce((acc, t) => acc + t.kills, 0);

  const teamByTag = useMemo(() => new Map(teams.map(t => [t.tag, t])), []);

  /** Resolve an event's spatial position so we can plot it / focus the map. */
  const eventPoint = useCallback((e: GameEvent): { x: number; y: number } | null => {
    if (e.type === "ring") {
      const phase = ringPhases.find(p => e.t >= p.startSec && e.t <= p.endSec) ?? ringPhases[0];
      return { x: phase.cx, y: phase.cy };
    }
    if (e.team) {
      const team = teamByTag.get(e.team);
      if (!team) return null;
      const traj = trajectories[team.id];
      if (!traj || traj.length === 0) return null;
      let p = traj[0];
      for (const q of traj) { if (q.t <= e.t) p = q; else break; }
      return { x: p.x, y: p.y };
    }
    return null;
  }, [teamByTag, trajectories]);

  const filteredEvents = useMemo(() => events.filter(e => matchesFilter(e, eventFilter)), [eventFilter]);

  const handleEventClick = useCallback((e: GameEvent) => {
    setTime(e.t);
    setPlaying(false);
    const p = eventPoint(e);
    if (p) setFocusRequest({ x: p.x, y: p.y, token: Date.now() });
  }, [eventPoint]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar
        tournamentId={tournamentId}
        onTournamentChange={setTournamentId}
        matchId={matchId}
        onMatchChange={(id) => { setMatchId(id); setTime(0); setPlaying(false); }}
        mapName={apexMap.name}
        aliveTeams={aliveTeams}
        totalKills={totalKills}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[260px] shrink-0 flex-col border-r border-border bg-surface lg:flex">
          <PanelHeader title="Teams" subtitle={`${selectedTeams.size}/${teams.length} visible`} />
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {[...teams].sort((a, b) => a.placement - b.placement).map((t) => (
              <TeamRow key={t.id} team={t} active={selectedTeams.has(t.id)} hovered={hoverTeam === t.id}
                onToggle={() => toggleTeam(t.id)}
                onHover={(v) => setHoverTeam(v ? t.id : null)} />
            ))}
          </div>
          <div className="border-t border-border p-3">
            <div className="flex gap-2">
              <button onClick={() => setSelectedTeams(new Set(teams.map((t) => t.id)))}
                className="flex-1 rounded-sm border border-border-strong bg-surface-2 px-2 py-1.5 text-xs font-medium hover:bg-muted">Show all</button>
              <button onClick={() => setSelectedTeams(new Set())}
                className="flex-1 rounded-sm border border-border bg-surface px-2 py-1.5 text-xs font-medium hover:bg-muted">Hide all</button>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <MapCanvas
            time={time}
            ring={showRing ? ring : null}
            trajectories={trajectories}
            dwellsByTeam={dwellsByTeam}
            cfg={cfg}
            onCfg={setCfg}
            showConfig={showConfig}
            setShowConfig={setShowConfig}
            selectedTeams={selectedTeams}
            hoverTeam={hoverTeam}
            showTrails={showTrails}
            showLabels={showLabels}
            mapImage={apexMap.image}
            mapName={apexMap.name}
            aliveTeams={aliveTeams}
            totalKills={totalKills}
            ringIndex={ringPhases.findIndex((p) => time >= p.startSec && time <= p.endSec)}
            ringCount={ringPhases.length}
            controls={{ showTrails, setShowTrails, showRing, setShowRing, showLabels, setShowLabels }}
            focusRequest={focusRequest}
            onEventClick={handleEventClick}
          />

          <Timeline time={time} duration={match.durationSec} playing={playing} speed={speed}
            onSeek={setTime} onTogglePlay={() => setPlaying((p) => !p)} onSpeedChange={setSpeed} />
        </main>

        <aside className="hidden w-[300px] shrink-0 flex-col border-l border-border bg-surface xl:flex">
          <PanelHeader title="Match feed" subtitle={`${filteredEvents.length}/${events.length}`} />
          <div className="flex flex-wrap gap-1 border-b border-border px-2 py-2">
            {EVENT_FILTERS.map(f => {
              const count = f.id === "all" ? events.length : events.filter(e => matchesFilter(e, f.id)).length;
              const active = eventFilter === f.id;
              return (
                <button key={f.id} onClick={() => setEventFilter(f.id)}
                  className={`text-mono rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                    active
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-surface-2 text-muted-foreground hover:text-foreground"
                  } ${count === 0 ? "opacity-40" : ""}`}>
                  {f.label} <span className="ml-0.5 opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredEvents.length === 0 && (
              <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                Нет событий в этой категории
              </div>
            )}
            {filteredEvents.map((e, i) => {
              const active = time >= e.t - 4 && time <= e.t + 4;
              const past = time > e.t + 4;
              return (
                <button key={i} onClick={() => handleEventClick(e)}
                  className={`group flex w-full items-start gap-3 border-b border-border px-3 py-2.5 text-left transition-colors ${
                    active ? "bg-primary/10" : past ? "opacity-60 hover:bg-muted" : "hover:bg-muted"}`}>
                  <span className="text-mono mt-0.5 w-12 shrink-0 text-xs text-muted-foreground">{formatTime(e.t)}</span>
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: eventColor(e.type) }} />
                  <span className="min-w-0 text-xs leading-snug">
                    <span className="label-eyebrow mr-1.5 text-[10px]">{e.type}</span>
                    <span className="text-foreground">{e.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}

function eventColor(type: string) {
  switch (type) {
    case "kill":
    case "wipe":  return "#ff5b12";
    case "knock": return "#fde68a";
    case "ring":  return "#22c4f5";
    case "care":  return "#86efac";
    default:      return "#94a3b8";
  }
}

/* ---------- TOP BAR ---------- */
function TopBar({
  tournamentId, onTournamentChange, matchId, onMatchChange, mapName, aliveTeams, totalKills,
}: {
  tournamentId: string; onTournamentChange: (id: string) => void;
  matchId: string; onMatchChange: (id: string) => void;
  mapName: string; aliveTeams: number; totalKills: number;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
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

      <div className="ml-2 h-6 w-px bg-border" />

      <Select label="Tournament" value={tournamentId} onChange={onTournamentChange}
        options={tournaments.map((t) => ({ value: t.id, label: t.name }))} />
      <Select label="Match" value={matchId} onChange={onMatchChange}
        options={matches.filter((m) => m.tournamentId === tournamentId).map((m) => ({ value: m.id, label: m.name }))} />
      <div className="hud-panel hidden items-center gap-2 px-3 py-1.5 text-xs md:flex">
        <span className="label-eyebrow text-[10px]">Map</span>
        <span className="text-mono font-semibold">{mapName}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-mono hidden text-xs text-muted-foreground sm:inline">
          {aliveTeams} alive · {totalKills} kills
        </span>
        <span className="flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2.5 py-1 text-xs">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
          <span className="label-eyebrow text-[10px]">Live</span>
        </span>
        <Link to="/admin" className="rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider hover:bg-muted">
          Admin
        </Link>
      </div>
    </header>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <label className="hud-panel flex items-center gap-2 px-2.5 py-1.5 text-xs">
      <span className="label-eyebrow text-[10px]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="text-mono bg-transparent text-xs font-medium text-foreground outline-none">
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-surface text-foreground">{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function PanelHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
      <h2 className="text-xs font-bold uppercase tracking-wider">{title}</h2>
      {subtitle && <span className="text-mono text-[10px] text-muted-foreground">{subtitle}</span>}
    </div>
  );
}

function TeamRow({ team, active, hovered, onToggle, onHover }: {
  team: Team; active: boolean; hovered: boolean; onToggle: () => void; onHover: (v: boolean) => void;
}) {
  const slotColor = getSlotColor(teams.indexOf(team));
  return (
    <div onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}
      className={`group relative mb-1 flex cursor-pointer items-center gap-2.5 rounded-sm border px-2 py-1.5 transition-colors ${
        active ? "border-border-strong bg-surface-2" : "border-transparent bg-transparent opacity-50"
      } ${hovered ? "ring-1 ring-primary/40" : ""}`} onClick={onToggle}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: slotColor }} />
      <TeamLogo team={team} size={20} />
      <span className="text-mono w-6 text-[10px] tabular-nums text-muted-foreground">#{team.placement}</span>
      <span className="min-w-0 flex-1 truncate text-xs font-semibold">{team.name}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${team.alive ? "bg-success" : "bg-destructive/70"}`} />
    </div>
  );
}

function LayerToggle({ label, active, onChange }: { label: string; active: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!active)}
      className={`flex items-center justify-between gap-3 rounded-sm px-2 py-1 text-[11px] transition-colors ${
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
      <span className="label-eyebrow text-[10px]">{label}</span>
      <span className={`h-1.5 w-3 rounded-full ${active ? "bg-primary" : "bg-border-strong"}`} />
    </button>
  );
}

function CfgSlider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-0.5">
        <span className="label-eyebrow text-[10px]">{label}</span>
        <span className="text-mono text-[10px] text-muted-foreground tabular-nums">
          {Number.isInteger(step) ? value : value.toFixed(2)}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary" />
    </label>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="hud-panel-strong px-3 py-1.5">
      <div className="label-eyebrow text-[9px]">{label}</div>
      <div className={`text-mono text-sm font-bold tabular-nums ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

type Cfg = { trailWidth: number; labelSize: number; labelBg: number; dwellWindow: number; dwellRadius: number };
type Dwell = { x: number; y: number; tStart: number; tEnd: number };

/* ---------- MAP with pan/zoom ---------- */
function MapCanvas({
  time, ring, trajectories, dwellsByTeam, cfg, onCfg, showConfig, setShowConfig,
  selectedTeams, hoverTeam, showTrails, showLabels,
  mapImage, mapName, aliveTeams, totalKills, ringIndex, ringCount, controls,
  focusRequest, onEventClick,
}: {
  time: number; ring: RingPhase | null;
  trajectories: Record<string, { t: number; x: number; y: number }[]>;
  dwellsByTeam: Record<string, Dwell[]>;
  cfg: Cfg;
  onCfg: (next: Cfg) => void;
  showConfig: boolean;
  setShowConfig: (v: boolean) => void;
  selectedTeams: Set<string>; hoverTeam: string | null;
  showTrails: boolean; showLabels: boolean;
  mapImage: string; mapName: string;
  aliveTeams: number; totalKills: number;
  ringIndex: number; ringCount: number;
  controls: {
    showTrails: boolean; setShowTrails: (v: boolean) => void;
    showRing: boolean; setShowRing: (v: boolean) => void;
    showLabels: boolean; setShowLabels: (v: boolean) => void;
  };
  focusRequest: { x: number; y: number; token: number } | null;
  onEventClick: (e: GameEvent) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const clampScale = (s: number) => Math.max(1, Math.min(6, s));

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    setView((v) => {
      const factor = Math.exp(-e.deltaY * 0.0015);
      const ns = clampScale(v.scale * factor);
      const k = ns / v.scale;
      // keep cursor point stable
      const ntx = cx - k * (cx - v.tx);
      const nty = cy - k * (cy - v.ty);
      return clampPan({ scale: ns, tx: ntx, ty: nty }, rect.width, rect.height);
    });
  }, []);

  const clampPan = (v: { scale: number; tx: number; ty: number }, w: number, h: number) => {
    const minX = w - w * v.scale;
    const minY = h - h * v.scale;
    return { scale: v.scale, tx: Math.min(0, Math.max(minX, v.tx)), ty: Math.min(0, Math.max(minY, v.ty)) };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const nx = drag.current.tx + (e.clientX - drag.current.x);
    const ny = drag.current.ty + (e.clientY - drag.current.y);
    setView((v) => clampPan({ scale: v.scale, tx: nx, ty: ny }, rect.width, rect.height));
  };
  const onMouseUp = () => { drag.current = null; };

  const zoomBy = (factor: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    setView((v) => {
      const ns = clampScale(v.scale * factor);
      const k = ns / v.scale;
      return clampPan({ scale: ns, tx: cx - k * (cx - v.tx), ty: cy - k * (cy - v.ty) }, rect.width, rect.height);
    });
  };
  const resetView = () => setView({ scale: 1, tx: 0, ty: 0 });

  // Center the map on an external focus request (event click in feed).
  useEffect(() => {
    if (!focusRequest || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const offsetX = (rect.width - size) / 2;
    const offsetY = (rect.height - size) / 2;
    const targetScale = 2.5;
    const px = offsetX + focusRequest.x * size;
    const py = offsetY + focusRequest.y * size;
    const tx = rect.width / 2 - targetScale * px;
    const ty = rect.height / 2 - targetScale * py;
    setView(clampPan({ scale: targetScale, tx, ty }, rect.width, rect.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.token]);

  return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      className="relative min-h-0 flex-1 overflow-hidden bg-background hud-grid-bg select-none"
      style={{ cursor: drag.current ? "grabbing" : "grab" }}
    >
      <div
        className="absolute inset-0 origin-top-left"
        style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
      >
        <div className="relative h-full w-full">
          <img src={mapImage} alt={mapName} draggable={false}
            className="absolute inset-0 h-full w-full object-contain opacity-95" />
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 h-full w-full pointer-events-none">
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2.5" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {ring && (
              <>
                {/* Static preview of all 6 ring phases */}
                {ringPhases.map((p, i) => (
                  <circle key={`prev-${i}`} cx={p.cx * 1000} cy={p.cy * 1000} r={p.r * 1000}
                    fill="none" stroke="rgba(255,255,255,0.85)"
                    strokeWidth={1.6 / view.scale}
                    strokeDasharray={`${4 / view.scale} ${4 / view.scale}`} />
                ))}
                <circle cx={ring.cx * 1000} cy={ring.cy * 1000} r={ring.r * 1000}
                  fill="rgba(255,91,18,0.1)" stroke="rgba(255,91,18,1)" strokeWidth={3.5 / view.scale} strokeDasharray={`${10 / view.scale} ${5 / view.scale}`} />
                <circle cx={ring.cx * 1000} cy={ring.cy * 1000} r={3 / view.scale} fill="#ff5b12" />
              </>
            )}

            {teams.map((t, slotIdx) => {
              if (!selectedTeams.has(t.id)) return null;
              const slotColor = getSlotColor(slotIdx);
              const path = trajectories[t.id];
              const upTo = path.filter((p) => p.t <= time);
              if (upTo.length === 0) return null;
              const head = upTo[upTo.length - 1];
              const dimOthers = hoverTeam && hoverTeam !== t.id;
              const opacity = dimOthers ? 0.15 : 1;
              const trail = upTo.slice(-60);
              const d = trail.map((p, i) => `${i === 0 ? "M" : "L"}${p.x * 1000} ${p.y * 1000}`).join(" ");
              const dwells = (dwellsByTeam[t.id] ?? []).filter((dw) => dw.tStart <= time);
              const labelW = t.tag.length * (cfg.labelSize * 0.64) + cfg.labelSize * 0.55;
              const labelH = cfg.labelSize * 1.28;

              return (
                <g key={t.id} opacity={opacity}>
                  {/* Dwell clusters */}
                  {dwells.map((dw, di) => {
                    const dur = Math.round(dw.tEnd - dw.tStart);
                    return (
                      <g key={`dw-${di}`} transform={`translate(${dw.x * 1000} ${dw.y * 1000})`}>
                        <circle r={cfg.dwellRadius * 1000} fill={slotColor} fillOpacity={0.1}
                          stroke={slotColor} strokeOpacity={0.6}
                          strokeWidth={1.2 / view.scale}
                          strokeDasharray={`${3 / view.scale} ${3 / view.scale}`} />
                        <circle r={5 / view.scale} fill={slotColor} stroke="#000" strokeWidth={0.8 / view.scale} />
                        <g transform={`translate(0 ${cfg.dwellRadius * 1000 + 14 / view.scale})`}>
                          <rect
                            x={-32 / view.scale} y={-9 / view.scale}
                            width={64 / view.scale} height={18 / view.scale}
                            rx={2 / view.scale} ry={2 / view.scale}
                            fill={`rgba(0,0,0,${cfg.labelBg})`}
                            stroke={slotColor} strokeWidth={1 / view.scale}
                          />
                          <text x={0} y={4 / view.scale} textAnchor="middle"
                            fontSize={11 / view.scale} fontWeight={700} fill="#fff"
                            fontFamily="Manrope, sans-serif">
                            {formatTime(dw.tStart)} · {dur}s
                          </text>
                        </g>
                      </g>
                    );
                  })}
                  {showTrails && (
                    <path d={d} fill="none" stroke={slotColor}
                      strokeWidth={cfg.trailWidth / view.scale} strokeOpacity={0.75}
                      strokeLinecap="round" strokeLinejoin="round" />
                  )}
                  <g transform={`translate(${head.x * 1000} ${head.y * 1000})`}>
                    <g filter="url(#glow)">
                      <circle r={11 / view.scale} fill="none" stroke={slotColor} strokeWidth={1 / view.scale} opacity={0.5} />
                      <circle r={6 / view.scale} fill={slotColor} stroke="rgba(0,0,0,0.8)" strokeWidth={1 / view.scale} />
                    </g>
                    {showLabels && (
                      <g transform={`translate(${14 / view.scale} ${-(labelH / 2) / view.scale})`}>
                        <rect
                          x={0}
                          y={0}
                          rx={3 / view.scale}
                          ry={3 / view.scale}
                          width={labelW / view.scale}
                          height={labelH / view.scale}
                          fill={`rgba(0,0,0,${cfg.labelBg})`}
                          stroke={slotColor}
                          strokeWidth={2 / view.scale}
                        />
                        <text
                          x={(labelW / 2) / view.scale}
                          y={(labelH * 0.72) / view.scale}
                          textAnchor="middle"
                          fontSize={cfg.labelSize / view.scale}
                          fontWeight={800}
                          fill="#fff"
                          fontFamily="Manrope, sans-serif"
                          style={{ letterSpacing: `${0.6 / view.scale}px` }}
                        >
                          {t.tag}
                        </text>
                      </g>
                    )}
                  </g>
                </g>
              );
            })}

          </svg>
        </div>
      </div>

      {/* Map label (top-left) */}
      <div className="pointer-events-none absolute left-4 top-4">
        <div className="hud-panel-strong pointer-events-auto flex items-center gap-3 px-3 py-2 text-xs">
          <span className="label-eyebrow">Map</span>
          <span className="text-mono font-semibold tracking-wider">{mapName.toUpperCase()}</span>
        </div>
      </div>

      {/* Single CONFIG button (top-right) */}
      <div className="pointer-events-auto absolute right-4 top-4">
        <button onClick={() => setShowConfig(!showConfig)}
          className={`hud-panel-strong flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
            showConfig ? "text-primary" : "text-foreground hover:text-primary"}`}>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
          <span className="label-eyebrow text-[10px]">Config</span>
        </button>

        {showConfig && (
          <div className="mt-2 hud-panel-strong w-64 p-3 text-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="label-eyebrow">Layers</span>
              <button onClick={() => setShowConfig(false)} className="text-muted-foreground hover:text-foreground">×</button>
            </div>
            <div className="flex flex-col gap-1">
              <LayerToggle label="Trails" active={controls.showTrails} onChange={controls.setShowTrails} />
              <LayerToggle label="Ring" active={controls.showRing} onChange={controls.setShowRing} />
              <LayerToggle label="Labels" active={controls.showLabels} onChange={controls.setShowLabels} />
            </div>
            <div className="border-t border-border pt-2 space-y-3">
              <span className="label-eyebrow block">Map config</span>
              <CfgSlider label="Trail width" value={cfg.trailWidth} min={0.5} max={6} step={0.5}
                onChange={(v) => onCfg({ ...cfg, trailWidth: v })} />
              <CfgSlider label="Label size" value={cfg.labelSize} min={8} max={40} step={1}
                onChange={(v) => onCfg({ ...cfg, labelSize: v })} />
              <CfgSlider label="Label bg" value={cfg.labelBg} min={0} max={1} step={0.05}
                onChange={(v) => onCfg({ ...cfg, labelBg: v })} />
            </div>
            <div className="border-t border-border pt-2 space-y-3">
              <CfgSlider label="Dwell window (s)" value={cfg.dwellWindow} min={10} max={120} step={5}
                onChange={(v) => onCfg({ ...cfg, dwellWindow: v })} />
              <CfgSlider label="Dwell radius" value={cfg.dwellRadius} min={0.01} max={0.12} step={0.005}
                onChange={(v) => onCfg({ ...cfg, dwellRadius: v })} />
            </div>
          </div>
        )}
      </div>

      {/* Zoom controls */}
      <div className="pointer-events-auto absolute right-4 bottom-4 hud-panel-strong flex flex-col overflow-hidden text-xs">
        <button onClick={() => zoomBy(1.5)} className="flex h-8 w-8 items-center justify-center border-b border-border hover:bg-muted" aria-label="Zoom in">+</button>
        <button onClick={() => zoomBy(1 / 1.5)} className="flex h-8 w-8 items-center justify-center border-b border-border hover:bg-muted" aria-label="Zoom out">−</button>
        <button onClick={resetView} className="text-mono flex h-8 w-8 items-center justify-center text-[9px] hover:bg-muted" aria-label="Reset zoom">1:1</button>
      </div>
      <div className="pointer-events-none absolute bottom-4 right-16 hud-panel-strong px-2 py-1 text-mono text-[10px] text-muted-foreground">
        {(view.scale * 100).toFixed(0)}%
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 flex gap-2">
        <Stat label="Alive" value={`${aliveTeams}/${teams.length}`} accent />
        <Stat label="Kills" value={totalKills.toString()} />
        <Stat label="Ring" value={`${ringIndex + 1 || ringCount}/${ringCount}`} />
      </div>
    </div>
  );
}

/* ---------- TIMELINE ---------- */
function Timeline({
  time, duration, playing, speed, onSeek, onTogglePlay, onSpeedChange,
}: {
  time: number; duration: number; playing: boolean; speed: number;
  onSeek: (t: number) => void; onTogglePlay: () => void; onSpeedChange: (s: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const onTrack = (e: React.MouseEvent) => {
    const r = trackRef.current!.getBoundingClientRect();
    const k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onSeek(k * duration);
  };
  const speeds = [1, 2, 4, 8];

  return (
    <div className="shrink-0 border-t border-border bg-surface">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button onClick={onTogglePlay}
          className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-colors hover:brightness-110"
          aria-label={playing ? "Pause" : "Play"}>
          {playing ? (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
          ) : (
            <svg className="h-3.5 w-3.5 translate-x-[1px]" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4 L20 12 L6 20 Z" /></svg>
          )}
        </button>
        <button onClick={() => onSeek(Math.max(0, time - 10))} className="text-mono rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-[10px] hover:bg-muted">−10s</button>
        <button onClick={() => onSeek(Math.min(duration, time + 10))} className="text-mono rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-[10px] hover:bg-muted">+10s</button>

        <div className="text-mono flex items-center gap-1 text-xs tabular-nums">
          <span className="font-semibold">{formatTime(time)}</span>
          <span className="text-muted-foreground">/ {formatTime(duration)}</span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <span className="label-eyebrow text-[10px] mr-1">Speed</span>
          {speeds.map((s) => (
            <button key={s} onClick={() => onSpeedChange(s)}
              className={`text-mono rounded-sm px-2 py-1 text-[10px] font-semibold ${
                speed === s ? "bg-primary text-primary-foreground" : "border border-border bg-surface-2 text-muted-foreground hover:text-foreground"}`}>{s}×</button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-3">
        <div ref={trackRef} onClick={onTrack} className="relative h-9 cursor-pointer rounded-sm border border-border bg-background">
          {ringPhases.map((p, i) => (
            <div key={i} className="absolute top-0 h-full border-r border-border/60"
              style={{
                left: `${(p.startSec / duration) * 100}%`,
                width: `${((p.endSec - p.startSec) / duration) * 100}%`,
                background: `rgba(255,91,18,${0.04 + i * 0.025})`,
              }}>
              <div className="text-mono absolute left-1 top-0.5 text-[9px] uppercase text-muted-foreground/80">R{i + 1}</div>
            </div>
          ))}
          {events.map((e, i) => (
            <div key={i} className="absolute top-0 h-full w-px"
              style={{ left: `${(e.t / duration) * 100}%`, backgroundColor: eventColor(e.type), opacity: 0.7 }}
              title={`${formatTime(e.t)} — ${e.label}`} />
          ))}
          <div className="absolute top-0 h-full w-0.5 bg-primary shadow-[0_0_8px_rgba(255,91,18,0.8)]"
            style={{ left: `${(time / duration) * 100}%` }}>
            <div className="absolute -left-1.5 -top-1 h-2.5 w-2.5 rotate-45 bg-primary" />
          </div>
        </div>
      </div>
    </div>
  );
}
