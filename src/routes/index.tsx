import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
} from "../lib/mock-match";

export const Route = createFileRoute("/")({ component: MatchViewer });

function formatTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function MatchViewer() {
  const [tournamentId, setTournamentId] = useState(tournaments[0].id);
  const [matchId, setMatchId] = useState(matches[0].id);
  const match = matches.find((m) => m.id === matchId)!;
  const mapName = maps.find((m) => m.id === match.mapId)?.name ?? "—";

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(
    () => new Set(teams.map((t) => t.id)),
  );
  const [hoverTeam, setHoverTeam] = useState<string | null>(null);
  const [showTrails, setShowTrails] = useState(true);
  const [showRing, setShowRing] = useState(true);
  const [showPOI, setShowPOI] = useState(true);

  const trajectories = useMemo(
    () => Object.fromEntries(teams.map((t, i) => [t.id, generateTrajectory(i + 7, match.durationSec)])),
    [match.durationSec],
  );

  // Playback loop
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const nt = t + dt * speed;
        if (nt >= match.durationSec) {
          setPlaying(false);
          return match.durationSec;
        }
        return nt;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, match.durationSec]);

  // Current ring (interpolated)
  const ring = useMemo<RingPhase>(() => {
    const cur = ringPhases.find((p) => time >= p.startSec && time <= p.endSec) ?? ringPhases[ringPhases.length - 1];
    const next = ringPhases[ringPhases.indexOf(cur) + 1];
    if (!next) return cur;
    const k = Math.max(0, Math.min(1, (time - cur.startSec) / (cur.endSec - cur.startSec)));
    return {
      ...cur,
      cx: cur.cx + (next.cx - cur.cx) * k,
      cy: cur.cy + (next.cy - cur.cy) * k,
      r: cur.r + (next.r - cur.r) * k,
    };
  }, [time]);

  const toggleTeam = (id: string) => {
    setSelectedTeams((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const aliveTeams = teams.filter((t) => t.alive).length;
  const totalKills = teams.reduce((acc, t) => acc + t.kills, 0);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar
        tournamentId={tournamentId}
        onTournamentChange={setTournamentId}
        matchId={matchId}
        onMatchChange={(id) => { setMatchId(id); setTime(0); setPlaying(false); }}
        mapName={mapName}
        aliveTeams={aliveTeams}
        totalKills={totalKills}
      />

      <div className="flex min-h-0 flex-1">
        {/* LEFT: Team list */}
        <aside className="hidden w-[260px] shrink-0 flex-col border-r border-border bg-surface lg:flex">
          <PanelHeader title="Teams" subtitle={`${selectedTeams.size}/${teams.length} visible`} />
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {[...teams].sort((a, b) => a.placement - b.placement).map((t) => (
              <TeamRow
                key={t.id}
                team={t}
                active={selectedTeams.has(t.id)}
                hovered={hoverTeam === t.id}
                onToggle={() => toggleTeam(t.id)}
                onHover={(v) => setHoverTeam(v ? t.id : null)}
              />
            ))}
          </div>
          <div className="border-t border-border p-3">
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedTeams(new Set(teams.map((t) => t.id)))}
                className="flex-1 rounded-sm border border-border-strong bg-surface-2 px-2 py-1.5 text-xs font-medium hover:bg-muted"
              >Show all</button>
              <button
                onClick={() => setSelectedTeams(new Set())}
                className="flex-1 rounded-sm border border-border bg-surface px-2 py-1.5 text-xs font-medium hover:bg-muted"
              >Hide all</button>
            </div>
          </div>
        </aside>

        {/* CENTER: Map */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden bg-background hud-grid-bg">
            <MapCanvas
              time={time}
              ring={showRing ? ring : null}
              trajectories={trajectories}
              selectedTeams={selectedTeams}
              hoverTeam={hoverTeam}
              showTrails={showTrails}
              showPOI={showPOI}
            />

            {/* Map overlay controls (top-left) */}
            <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-2">
              <div className="hud-panel-strong pointer-events-auto flex items-center gap-3 px-3 py-2 text-xs">
                <span className="label-eyebrow">Map</span>
                <span className="text-mono font-semibold tracking-wider">{mapName.toUpperCase()}</span>
              </div>
            </div>

            {/* Layer toggles (top-right) */}
            <div className="pointer-events-auto absolute right-4 top-4 hud-panel-strong flex flex-col gap-1 p-1.5 text-xs">
              <LayerToggle label="Trails" active={showTrails} onChange={setShowTrails} />
              <LayerToggle label="Ring" active={showRing} onChange={setShowRing} />
              <LayerToggle label="POI" active={showPOI} onChange={setShowPOI} />
            </div>

            {/* Live stats (bottom-left) */}
            <div className="pointer-events-none absolute bottom-4 left-4 flex gap-2">
              <Stat label="Alive" value={`${aliveTeams}/${teams.length}`} accent />
              <Stat label="Kills" value={totalKills.toString()} />
              <Stat label="Ring" value={`${ringPhases.findIndex((p) => time >= p.startSec && time <= p.endSec) + 1 || ringPhases.length}/${ringPhases.length}`} />
            </div>
          </div>

          {/* Timeline */}
          <Timeline
            time={time}
            duration={match.durationSec}
            playing={playing}
            speed={speed}
            onSeek={setTime}
            onTogglePlay={() => setPlaying((p) => !p)}
            onSpeedChange={setSpeed}
          />
        </main>

        {/* RIGHT: Events feed */}
        <aside className="hidden w-[300px] shrink-0 flex-col border-l border-border bg-surface xl:flex">
          <PanelHeader title="Match feed" subtitle={`${events.length} events`} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {events.map((e, i) => {
              const active = time >= e.t - 4 && time <= e.t + 4;
              const past = time > e.t + 4;
              return (
                <button
                  key={i}
                  onClick={() => setTime(e.t)}
                  className={`group flex w-full items-start gap-3 border-b border-border px-3 py-2.5 text-left transition-colors ${
                    active ? "bg-primary/10" : past ? "opacity-60 hover:bg-muted" : "hover:bg-muted"
                  }`}
                >
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
  tournamentId, onTournamentChange,
  matchId, onMatchChange,
  mapName, aliveTeams, totalKills,
}: {
  tournamentId: string;
  onTournamentChange: (id: string) => void;
  matchId: string;
  onMatchChange: (id: string) => void;
  mapName: string;
  aliveTeams: number;
  totalKills: number;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M12 3 L21 20 H3 Z" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold tracking-tight">APEX STATS</div>
          <div className="label-eyebrow text-[9px]">VOD analytics</div>
        </div>
      </div>

      <div className="ml-2 h-6 w-px bg-border" />

      <Select label="Tournament" value={tournamentId} onChange={onTournamentChange} options={tournaments.map((t) => ({ value: t.id, label: t.name }))} />
      <Select label="Match" value={matchId} onChange={onMatchChange} options={matches.filter((m) => m.tournamentId === tournamentId).map((m) => ({ value: m.id, label: m.name }))} />
      <div className="hud-panel hidden items-center gap-2 px-3 py-1.5 text-xs md:flex">
        <span className="label-eyebrow text-[10px]">Map</span>
        <span className="text-mono font-semibold">{mapName}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2.5 py-1 text-xs">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
          <span className="label-eyebrow text-[10px]">Live data</span>
        </span>
        <span className="text-mono hidden text-xs text-muted-foreground sm:inline">
          {aliveTeams} alive · {totalKills} kills
        </span>
      </div>
    </header>
  );
}

function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="hud-panel flex items-center gap-2 px-2.5 py-1.5 text-xs">
      <span className="label-eyebrow text-[10px]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-mono bg-transparent text-xs font-medium text-foreground outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-surface text-foreground">{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/* ---------- PANEL ---------- */
function PanelHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
      <h2 className="text-xs font-bold uppercase tracking-wider">{title}</h2>
      {subtitle && <span className="text-mono text-[10px] text-muted-foreground">{subtitle}</span>}
    </div>
  );
}

function TeamRow({
  team, active, hovered, onToggle, onHover,
}: {
  team: Team;
  active: boolean;
  hovered: boolean;
  onToggle: () => void;
  onHover: (v: boolean) => void;
}) {
  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={`group relative mb-1 flex cursor-pointer items-center gap-2.5 rounded-sm border px-2 py-1.5 transition-colors ${
        active ? "border-border-strong bg-surface-2" : "border-transparent bg-transparent opacity-50"
      } ${hovered ? "ring-1 ring-primary/40" : ""}`}
      onClick={onToggle}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: team.color, boxShadow: active ? `0 0 8px ${team.color}80` : "none" }}
      />
      <span className="text-mono w-6 text-[10px] tabular-nums text-muted-foreground">#{team.placement}</span>
      <span className="min-w-0 flex-1 truncate text-xs font-semibold">{team.tag}</span>
      <span className="text-mono text-[10px] text-muted-foreground">{team.kills}K</span>
      <span className={`h-1.5 w-1.5 rounded-full ${team.alive ? "bg-success" : "bg-destructive/70"}`} />
    </div>
  );
}

function LayerToggle({ label, active, onChange }: { label: string; active: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!active)}
      className={`flex items-center justify-between gap-3 rounded-sm px-2 py-1 text-[11px] transition-colors ${
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      <span className="label-eyebrow text-[10px]">{label}</span>
      <span className={`h-1.5 w-3 rounded-full ${active ? "bg-primary" : "bg-border-strong"}`} />
    </button>
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

/* ---------- MAP ---------- */
function MapCanvas({
  time, ring, trajectories, selectedTeams, hoverTeam, showTrails, showPOI,
}: {
  time: number;
  ring: RingPhase | null;
  trajectories: Record<string, { t: number; x: number; y: number }[]>;
  selectedTeams: Set<string>;
  hoverTeam: string | null;
  showTrails: boolean;
  showPOI: boolean;
}) {
  // POIs in normalized coords
  const pois = [
    { x: 0.22, y: 0.30, name: "FRAGMENT" },
    { x: 0.48, y: 0.22, name: "SKYHOOK" },
    { x: 0.74, y: 0.34, name: "REFINERY" },
    { x: 0.30, y: 0.55, name: "LAVA SIPHON" },
    { x: 0.58, y: 0.50, name: "GEYSER" },
    { x: 0.78, y: 0.62, name: "STACKS" },
    { x: 0.20, y: 0.78, name: "LAUNCH SITE" },
    { x: 0.50, y: 0.80, name: "CLIMATIZER" },
    { x: 0.70, y: 0.84, name: "TRIALS" },
  ];

  return (
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full">
      <defs>
        <radialGradient id="land-grad" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor="#1e2c3e" />
          <stop offset="100%" stopColor="#16202e" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Land mass */}
      <path
        d="M 120 280 Q 60 420 130 560 Q 90 700 200 820 Q 320 900 480 880 Q 660 910 800 820 Q 920 720 900 560 Q 950 400 850 280 Q 720 140 540 160 Q 360 140 230 200 Q 170 230 120 280 Z"
        fill="url(#land-grad)"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1}
      />

      {/* Topographic contour lines */}
      {[0.85, 0.7, 0.55, 0.4, 0.28].map((s, i) => (
        <ellipse
          key={i}
          cx={500} cy={520}
          rx={360 * s} ry={300 * s}
          fill="none"
          stroke="rgba(140,180,210,0.06)"
          strokeWidth={1}
          strokeDasharray="2 4"
        />
      ))}

      {/* Rivers */}
      <path d="M 180 320 Q 320 380 420 500 Q 500 620 640 700" stroke="rgba(34,196,245,0.15)" strokeWidth={4} fill="none" />
      <path d="M 760 280 Q 700 440 760 580 Q 800 700 720 800" stroke="rgba(34,196,245,0.12)" strokeWidth={3} fill="none" />

      {/* POIs */}
      {showPOI && pois.map((p, i) => (
        <g key={i} transform={`translate(${p.x * 1000} ${p.y * 1000})`}>
          <rect x={-3} y={-3} width={6} height={6} fill="rgba(255,91,18,0.9)" />
          <rect x={-5} y={-5} width={10} height={10} fill="none" stroke="rgba(255,91,18,0.35)" strokeWidth={1} />
          <text x={9} y={3} fontSize={9} fill="rgba(220,230,240,0.65)" fontFamily="JetBrains Mono, monospace" fontWeight={600} letterSpacing={1}>{p.name}</text>
        </g>
      ))}

      {/* Ring */}
      {ring && (
        <>
          <circle cx={ring.cx * 1000} cy={ring.cy * 1000} r={ring.r * 1000} fill="rgba(255,91,18,0.04)" stroke="rgba(255,91,18,0.55)" strokeWidth={1.5} strokeDasharray="6 4" />
          <circle cx={ring.cx * 1000} cy={ring.cy * 1000} r={2.5} fill="#ff5b12" />
        </>
      )}

      {/* Trails + team markers */}
      {teams.map((t) => {
        if (!selectedTeams.has(t.id)) return null;
        const path = trajectories[t.id];
        const upTo = path.filter((p) => p.t <= time);
        if (upTo.length === 0) return null;
        const head = upTo[upTo.length - 1];
        const dimOthers = hoverTeam && hoverTeam !== t.id;
        const opacity = dimOthers ? 0.18 : 1;

        const trail = upTo.slice(-60); // last 6 minutes of trail
        const d = trail.map((p, i) => `${i === 0 ? "M" : "L"}${p.x * 1000} ${p.y * 1000}`).join(" ");

        return (
          <g key={t.id} opacity={opacity}>
            {showTrails && (
              <path d={d} fill="none" stroke={t.color} strokeWidth={1.5} strokeOpacity={0.55} strokeLinecap="round" strokeLinejoin="round" />
            )}
            <g transform={`translate(${head.x * 1000} ${head.y * 1000})`} filter="url(#glow)">
              <circle r={9} fill="none" stroke={t.color} strokeWidth={1} opacity={0.4} />
              <circle r={5} fill={t.color} />
              <text x={9} y={3} fontSize={10} fontWeight={700} fill="#fff" fontFamily="Manrope, sans-serif" stroke="rgba(0,0,0,0.6)" strokeWidth={2.5} paintOrder="stroke">{t.tag}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- TIMELINE ---------- */
function Timeline({
  time, duration, playing, speed, onSeek, onTogglePlay, onSpeedChange,
}: {
  time: number;
  duration: number;
  playing: boolean;
  speed: number;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
  onSpeedChange: (s: number) => void;
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
        <button
          onClick={onTogglePlay}
          className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-colors hover:brightness-110"
          aria-label={playing ? "Pause" : "Play"}
        >
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
            <button
              key={s}
              onClick={() => onSpeedChange(s)}
              className={`text-mono rounded-sm px-2 py-1 text-[10px] font-semibold ${
                speed === s ? "bg-primary text-primary-foreground" : "border border-border bg-surface-2 text-muted-foreground hover:text-foreground"
              }`}
            >{s}×</button>
          ))}
        </div>
      </div>

      {/* Track */}
      <div className="px-4 pb-3">
        <div
          ref={trackRef}
          onClick={onTrack}
          className="relative h-9 cursor-pointer rounded-sm border border-border bg-background"
        >
          {/* Ring phase bands */}
          {ringPhases.map((p, i) => (
            <div
              key={i}
              className="absolute top-0 h-full border-r border-border/60"
              style={{
                left: `${(p.startSec / duration) * 100}%`,
                width: `${((p.endSec - p.startSec) / duration) * 100}%`,
                background: `rgba(255,91,18,${0.04 + i * 0.025})`,
              }}
            >
              <div className="text-mono absolute left-1 top-0.5 text-[9px] uppercase text-muted-foreground/80">R{i + 1}</div>
            </div>
          ))}
          {/* Event ticks */}
          {events.map((e, i) => (
            <div
              key={i}
              className="absolute top-0 h-full w-px"
              style={{ left: `${(e.t / duration) * 100}%`, backgroundColor: eventColor(e.type), opacity: 0.7 }}
              title={`${formatTime(e.t)} — ${e.label}`}
            />
          ))}
          {/* Playhead */}
          <div className="absolute top-0 h-full w-0.5 bg-primary shadow-[0_0_8px_rgba(255,91,18,0.8)]" style={{ left: `${(time / duration) * 100}%` }}>
            <div className="absolute -left-1.5 -top-1 h-2.5 w-2.5 rotate-45 bg-primary" />
          </div>
        </div>
      </div>
    </div>
  );
}
