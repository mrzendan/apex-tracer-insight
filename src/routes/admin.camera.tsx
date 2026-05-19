import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { maps as allMaps, teams as seedTeams } from "@/lib/mock-match";
import { useAdminStore } from "@/lib/admin-store";
import { getSlotColor } from "@/lib/team-colors";

export const Route = createFileRoute("/admin/camera")({ component: CameraAdmin });

/** Camera tracking parameters — consumed by the backend tracker. */
type TrackingSettings = {
  smoothing: number;
  deadzone: number;
  responseSpeed: number;
  maxSpeed: number;
  zoomMin: number;
  zoomMax: number;
  zoomStep: number;
  zoomLerp: number;
  ringWeight: number;
  ringNoise: number;
  teamWeight: number;
  jumpThreshold: number;
  preJumpUnlock: number;
  ema: number;
};

type Viewport = { x: number; y: number; size: number };
type Preset = {
  id: string;
  name: string;
  videoUrl: string;
  cropLeft: number;
  cropRight: number;
  viewport: Viewport;
  settings: TrackingSettings;
};

const SRC_W = 1920;
const SRC_H = 1080;

const baseSettings: TrackingSettings = {
  smoothing: 0.55, deadzone: 18, responseSpeed: 0.45, maxSpeed: 60,
  zoomMin: 1.0, zoomMax: 2.4, zoomStep: 0.1, zoomLerp: 0.35,
  ringWeight: 0.5, ringNoise: 0.25, teamWeight: 0.6,
  jumpThreshold: 140, preJumpUnlock: 0.6,
  ema: 14,
};

const SAMPLE_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

const defaultPresets: Preset[] = [
  {
    id: "p-step", name: "Step zoom",
    videoUrl: SAMPLE_VIDEO, cropLeft: 420, cropRight: 420,
    viewport: { x: 0, y: 0, size: 1 },
    settings: { ...baseSettings, zoomLerp: 0.0, zoomStep: 0.25, smoothing: 0.7 },
  },
  {
    id: "p-smooth", name: "Smooth observer",
    videoUrl: SAMPLE_VIDEO, cropLeft: 420, cropRight: 420,
    viewport: { x: 0.2, y: 0.2, size: 0.6 },
    settings: { ...baseSettings, smoothing: 0.85, zoomLerp: 0.7, responseSpeed: 0.35, ema: 22 },
  },
  {
    id: "p-fast", name: "Fast camera",
    videoUrl: SAMPLE_VIDEO, cropLeft: 420, cropRight: 420,
    viewport: { x: 0.3, y: 0.3, size: 0.4 },
    settings: { ...baseSettings, smoothing: 0.15, responseSpeed: 0.95, maxSpeed: 220, deadzone: 0, jumpThreshold: 60, ema: 3 },
  },
  {
    id: "p-lownoise", name: "Low noise",
    videoUrl: SAMPLE_VIDEO, cropLeft: 420, cropRight: 420,
    viewport: { x: 0.1, y: 0.1, size: 0.7 },
    settings: { ...baseSettings, ringWeight: 0.85, ringNoise: 0.7, teamWeight: 0.3, smoothing: 0.75 },
  },
  {
    id: "p-custom", name: "Custom",
    videoUrl: SAMPLE_VIDEO, cropLeft: 420, cropRight: 420,
    viewport: { x: 0.2, y: 0.2, size: 0.6 },
    settings: { ...baseSettings },
  },
];

type ViewMode = "overview" | "graphs" | "settings" | "debug";
type SplitOpts = {
  syncMapVideo: boolean;
  lockZoom: boolean;
  showRingCenter: boolean;
  showCameraBbox: boolean;
};

/** Synthetic event markers placed at fractions of duration for the timeline / charts. */
type TrackEvent = { t: number; kind: "ring" | "jump" | "relock" | "lost" | "manual"; label: string };
const eventColor: Record<TrackEvent["kind"], string> = {
  ring: "#22d3ee",
  jump: "#ef4444",
  relock: "#22c55e",
  lost: "#f59e0b",
  manual: "#a855f7",
};
const eventLabel: Record<TrackEvent["kind"], string> = {
  ring: "Ring closing",
  jump: "Jump detected",
  relock: "Relock",
  lost: "Lost tracking",
  manual: "Manual correction",
};

function buildEvents(duration: number): TrackEvent[] {
  const frac: Array<[number, TrackEvent["kind"]]> = [
    [0.15, "jump"], [0.16, "relock"],
    [0.25, "ring"],
    [0.35, "lost"],
    [0.42, "jump"], [0.43, "relock"],
    [0.50, "manual"],
    [0.60, "ring"],
    [0.70, "jump"], [0.71, "relock"],
    [0.78, "lost"],
    [0.85, "ring"],
    [0.92, "jump"], [0.925, "relock"],
  ];
  return frac.map(([f, k]) => ({ t: f * duration, kind: k, label: eventLabel[k] }));
}

function CameraAdmin() {
  const { tournaments, matches } = useAdminStore();

  const [tournamentId, setTournamentId] = useState(tournaments[0]?.id ?? "");
  const tournamentMatches = useMemo(
    () => matches.filter((m) => m.tournamentId === tournamentId),
    [matches, tournamentId],
  );
  const [matchId, setMatchId] = useState(tournamentMatches[0]?.id ?? "");
  useEffect(() => { setMatchId(tournamentMatches[0]?.id ?? ""); }, [tournamentId]);
  const match = matches.find((m) => m.id === matchId);
  const matchMapIds = (match?.mapIds && match.mapIds.length ? match.mapIds : match ? [match.mapId] : []);
  const [mapId, setMapId] = useState(matchMapIds[0] ?? allMaps[0].id);
  useEffect(() => { setMapId(matchMapIds[0] ?? allMaps[0].id); }, [matchId]);
  const map = allMaps.find((m) => m.id === mapId) ?? allMaps[0];

  const [presets, setPresets] = useState<Preset[]>(defaultPresets);
  const [activePresetId, setActivePresetId] = useState<string>(defaultPresets[0].id);
  const active = presets.find((p) => p.id === activePresetId) ?? presets[0];

  const [videoUrl, setVideoUrl] = useState(active.videoUrl);
  const [cropLeft, setCropLeft] = useState(active.cropLeft);
  const [cropRight, setCropRight] = useState(active.cropRight);
  const [viewport, setViewport] = useState<Viewport>(active.viewport);
  const [settings, setSettings] = useState<TrackingSettings>(active.settings);

  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(60);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // View mode + split overlay toggles
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [splitOpts, setSplitOpts] = useState<SplitOpts>({
    syncMapVideo: true, lockZoom: false, showRingCenter: true, showCameraBbox: true,
  });
  const [showOriginal, setShowOriginal] = useState(true);

  const loadPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setActivePresetId(id);
    setVideoUrl(p.videoUrl);
    setCropLeft(p.cropLeft);
    setCropRight(p.cropRight);
    setViewport(p.viewport);
    setSettings(p.settings);
  };
  const updateActivePreset = () => {
    setPresets((arr) => arr.map((p) => (p.id === activePresetId
      ? { ...p, videoUrl, cropLeft, cropRight, viewport, settings } : p)));
  };
  const saveCurrentAsPreset = () => {
    const name = prompt("Preset name?");
    if (!name) return;
    const np: Preset = { id: `p-${Date.now()}`, name, videoUrl, cropLeft, cropRight, viewport, settings };
    setPresets((arr) => [...arr, np]);
    setActivePresetId(np.id);
  };
  const deleteActivePreset = () => {
    if (presets.length <= 1) return;
    if (!confirm(`Delete preset "${active.name}"?`)) return;
    const next = presets.filter((p) => p.id !== activePresetId);
    setPresets(next);
    setActivePresetId(next[0].id);
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => setDuration(v.duration || 60);
    const onTime = () => setTime(v.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [videoUrl]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  };
  const seek = (t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = t;
    setTime(t);
  };

  const events = useMemo(() => buildEvents(duration), [duration]);

  // Quality metrics derived from current settings (so they react to tuning).
  const quality = useMemo(() => {
    const smoothness = settings.smoothing * 0.5 + (1 - settings.zoomLerp) * 0.1 + settings.ringWeight * 0.1;
    const stability = Math.max(0, 1 - settings.responseSpeed * 0.4 - (settings.maxSpeed / 500) * 0.3);
    const trackingQ = Math.round(Math.max(0, Math.min(1, 0.4 + smoothness * 0.4 + stability * 0.4)) * 100);
    const jumpEvents = events.filter((e) => e.kind === "jump").length;
    const lostFrames = Math.round(18 + settings.responseSpeed * 30 - settings.smoothing * 16);
    const avgConfidence = Math.max(0, Math.min(1, 0.55 + settings.smoothing * 0.25 + settings.ringWeight * 0.1));
    return { trackingQ, jumpEvents, lostFrames: Math.max(0, lostFrames), avgConfidence };
  }, [settings, events]);

  const teamPositions = useMemo(() => {
    const t = time;
    return seedTeams.slice(0, 12).map((tm, i) => {
      const a = (i / 12) * Math.PI * 2 + t * 0.08;
      const r = 0.18 + ((i * 37) % 17) / 100 + Math.sin(t * 0.4 + i) * 0.04;
      return {
        id: tm.id, tag: tm.tag, color: tm.color,
        x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r,
      };
    });
  }, [time]);

  const rings = useMemo(() => {
    const t = duration > 0 ? Math.max(0, Math.min(1, time / duration)) : 0;
    const drift = (k: number) => ({
      cx: 0.5 + Math.sin(t * 1.6 + k) * 0.08 * (1 - t),
      cy: 0.5 + Math.cos(t * 1.3 + k) * 0.08 * (1 - t),
    });
    return [
      { ...drift(0.3), r: 0.48 - 0.10 * t, color: "#22d3ee", label: "Ring 1" },
      { ...drift(1.7), r: 0.34 - 0.18 * t, color: "#f59e0b", label: "Ring 2" },
      { ...drift(2.9), r: 0.22 - 0.18 * t, color: "#ef4444", label: "Ring 3" },
      { ...drift(4.1), r: 0.12 - 0.10 * t, color: "#a855f7", label: "Ring 4" },
    ].filter((r) => r.r > 0.015);
  }, [time, duration]);

  // Viewport drag on map (disabled when locked)
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [vpDrag, setVpDrag] = useState<null | { kind: "move" | "resize"; startX: number; startY: number; v: Viewport }>(null);
  useEffect(() => {
    if (!vpDrag) return;
    const onMove = (e: MouseEvent) => {
      const el = mapRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - vpDrag.startX) / r.width;
      const dy = (e.clientY - vpDrag.startY) / r.height;
      setViewport((curr) => {
        if (vpDrag.kind === "move") {
          const x = Math.max(0, Math.min(1 - vpDrag.v.size, vpDrag.v.x + dx));
          const y = Math.max(0, Math.min(1 - vpDrag.v.size, vpDrag.v.y + dy));
          return { ...curr, x, y };
        }
        const size = Math.max(0.08, Math.min(1, vpDrag.v.size + Math.max(dx, dy)));
        const x = Math.min(vpDrag.v.x, 1 - size);
        const y = Math.min(vpDrag.v.y, 1 - size);
        return { x, y, size };
      });
    };
    const onUp = () => setVpDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [vpDrag]);

  // Pan/zoom (matches game analytics MapCanvas)
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const [mapView, setMapView] = useState({ scale: 1, tx: 0, ty: 0 });
  const mapPan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const clampScale = (s: number) => Math.max(1, Math.min(6, s));
  const clampPan = (v: { scale: number; tx: number; ty: number }, w: number, h: number) => {
    const minX = w - w * v.scale;
    const minY = h - h * v.scale;
    return { scale: v.scale, tx: Math.min(0, Math.max(minX, v.tx)), ty: Math.min(0, Math.max(minY, v.ty)) };
  };
  const onMapWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = mapWrapRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    setMapView((v) => {
      const ns = clampScale(v.scale * Math.exp(-e.deltaY * 0.0015));
      const k = ns / v.scale;
      return clampPan({ scale: ns, tx: cx - k * (cx - v.tx), ty: cy - k * (cy - v.ty) }, rect.width, rect.height);
    });
  };
  const onMapMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-vp-handle]")) return;
    mapPan.current = { x: e.clientX, y: e.clientY, tx: mapView.tx, ty: mapView.ty };
  };
  const onMapMouseMove = (e: React.MouseEvent) => {
    if (!mapPan.current) return;
    const rect = mapWrapRef.current!.getBoundingClientRect();
    const nx = mapPan.current.tx + (e.clientX - mapPan.current.x);
    const ny = mapPan.current.ty + (e.clientY - mapPan.current.y);
    setMapView((v) => clampPan({ scale: v.scale, tx: nx, ty: ny }, rect.width, rect.height));
  };
  const onMapMouseUp = () => { mapPan.current = null; };
  const zoomMapBy = (factor: number) => {
    const rect = mapWrapRef.current!.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    setMapView((v) => {
      const ns = clampScale(v.scale * factor);
      const k = ns / v.scale;
      return clampPan({ scale: ns, tx: cx - k * (cx - v.tx), ty: cy - k * (cy - v.ty) }, rect.width, rect.height);
    });
  };
  const resetMapView = () => setMapView({ scale: 1, tx: 0, ty: 0 });

  const visibleW = Math.max(1, SRC_W - cropLeft - cropRight);
  const visibleAspect = visibleW / SRC_H;

  const resetViewport = () => setViewport({ x: 0.2, y: 0.2, size: 0.6 });
  const fitMap = () => setViewport({ x: 0, y: 0, size: 1 });

  const showCharts = viewMode === "graphs" || viewMode === "debug";
  const compactSplit = viewMode === "graphs"; // shrink video/map when full charts are on

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold uppercase tracking-wider">Camera tracking</h1>
          <span className="text-mono text-xs text-muted-foreground">·</span>
          <select value={tournamentId} onChange={(e) => setTournamentId(e.target.value)}
            className="rounded-sm border border-border bg-background px-2 py-1 text-xs">
            {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={matchId} onChange={(e) => setMatchId(e.target.value)}
            className="rounded-sm border border-border bg-background px-2 py-1 text-xs"
            disabled={!tournamentMatches.length}>
            {tournamentMatches.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={mapId} onChange={(e) => setMapId(e.target.value)}
            className="rounded-sm border border-border bg-background px-2 py-1 text-xs">
            {(matchMapIds.length ? matchMapIds : allMaps.map((m) => m.id)).map((id) => {
              const m = allMaps.find((x) => x.id === id);
              return <option key={id} value={id}>{m?.name ?? id}</option>;
            })}
          </select>
        </div>
        {/* View mode tabs */}
        <div className="flex items-center gap-1">
          <span className="label-eyebrow mr-2 text-xs">View</span>
          {(["overview", "graphs", "settings", "debug"] as ViewMode[]).map((m) => (
            <button key={m} onClick={() => setViewMode(m)}
              className={`rounded-sm border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
                m === viewMode ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface-2 text-muted-foreground hover:bg-muted"
              }`}>{m}</button>
          ))}
        </div>
      </header>

      {/* Quality status bar */}
      <QualityBar quality={quality} preset={active.name} />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Split view controls */}
          <SplitControls
            opts={splitOpts}
            onChange={setSplitOpts}
            onReset={resetViewport}
            onFit={fitMap}
          />

          {/* Video + Map */}
          <div className={`grid min-h-0 ${compactSplit ? "flex-[0_0_38%]" : "flex-1"} grid-cols-2 gap-3 p-3`}>
            {/* Video */}
            <div className="hud-panel relative flex min-h-0 flex-col overflow-hidden bg-black">
              <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5">
                <div className="label-eyebrow text-xs">Observer video · crop L{cropLeft} / R{cropRight} px</div>
                <div className="text-mono text-xs text-muted-foreground">{fmt(time)} / {fmt(duration)}</div>
              </div>
              <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black p-2">
                <div
                  className="relative overflow-hidden border border-primary/40 bg-black"
                  style={{ aspectRatio: `${visibleAspect}`, maxWidth: "100%", maxHeight: "100%", width: "auto", height: "100%" }}
                >
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className="absolute top-0 h-full"
                    style={{
                      width: `${(SRC_W / visibleW) * 100}%`,
                      left: `${-(cropLeft / visibleW) * 100}%`,
                      maxWidth: "none",
                    }}
                    playsInline preload="metadata" crossOrigin="anonymous"
                  />
                  {splitOpts.showCameraBbox && (
                    <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-emerald-400/70" />
                  )}
                </div>
              </div>
            </div>

            {/* Map */}
            <div className="hud-panel relative flex min-h-0 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5">
                <div className="label-eyebrow text-xs">Map · {map.name}</div>
                <div className="text-mono text-xs text-muted-foreground">
                  zoom {(mapView.scale * 100).toFixed(0)}% · viewport {(viewport.size * 100).toFixed(0)}%
                </div>
              </div>
              <div
                ref={mapWrapRef}
                onWheel={onMapWheel}
                onMouseDown={onMapMouseDown}
                onMouseMove={onMapMouseMove}
                onMouseUp={onMapMouseUp}
                onMouseLeave={onMapMouseUp}
                className="relative min-h-0 flex-1 overflow-hidden bg-background hud-grid-bg select-none"
                style={{ cursor: mapPan.current ? "grabbing" : "grab" }}
              >
                <div
                  className="absolute inset-0 origin-top-left"
                  style={{ transform: `translate(${mapView.tx}px, ${mapView.ty}px) scale(${mapView.scale})` }}
                >
                  <div ref={mapRef} className="relative h-full w-full">
                    <img src={map.image} alt={map.name} draggable={false}
                      className="absolute inset-0 h-full w-full object-contain opacity-95" />
                    <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet"
                      className="pointer-events-none absolute inset-0 h-full w-full">
                      <defs>
                        <filter id="cam-glow">
                          <feGaussianBlur stdDeviation="2.5" result="b" />
                          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                        </filter>
                        <clipPath id="cam-map-bounds">
                          <rect x="0" y="0" width="1000" height="1000" />
                        </clipPath>
                      </defs>
                      {rings.length > 0 && (() => {
                        const active = rings[rings.length - 1];
                        return (
                          <g clipPath="url(#cam-map-bounds)">
                            {/* Red danger zone outside the active safe ring */}
                            <path
                              d={`M0,0 H1000 V1000 H0 Z M ${active.cx * 1000},${(active.cy * 1000) - active.r * 1000} a ${active.r * 1000},${active.r * 1000} 0 1,0 0,${active.r * 2000} a ${active.r * 1000},${active.r * 1000} 0 1,0 0,${-active.r * 2000} Z`}
                              fillRule="evenodd"
                              fill="rgba(239,68,68,0.28)"
                              stroke="none"
                            />
                            {/* Static preview of all ring phases */}
                            {rings.map((p, i) => (
                              <circle key={`prev-${i}`} cx={p.cx * 1000} cy={p.cy * 1000} r={p.r * 1000}
                                fill="none" stroke="rgba(255,255,255,0.85)"
                                strokeWidth={1.6 / mapView.scale}
                                strokeDasharray={`${4 / mapView.scale} ${4 / mapView.scale}`} />
                            ))}
                            <circle cx={active.cx * 1000} cy={active.cy * 1000} r={active.r * 1000}
                              fill="rgba(34,196,245,0.08)" stroke="#22c4f5"
                              strokeWidth={3.5 / mapView.scale}
                              strokeDasharray={`${10 / mapView.scale} ${5 / mapView.scale}`} />
                            {splitOpts.showRingCenter && (
                              <circle cx={active.cx * 1000} cy={active.cy * 1000} r={3 / mapView.scale} fill="#22c4f5" />
                            )}
                          </g>
                        );
                      })()}
                      {teamPositions.map((t, i) => {
                        const slot = getSlotColor(i);
                        const labelW = t.tag.length * 7 + 6;
                        const labelH = 14;
                        return (
                          <g key={t.id} filter="url(#cam-glow)">
                            <circle cx={t.x * 1000} cy={t.y * 1000} r={11 / mapView.scale}
                              fill="none" stroke={slot} strokeWidth={1 / mapView.scale} opacity={0.5} />
                            <circle cx={t.x * 1000} cy={t.y * 1000} r={6 / mapView.scale}
                              fill={slot} stroke="rgba(0,0,0,0.8)" strokeWidth={1 / mapView.scale} />
                            <g transform={`translate(${t.x * 1000 + 14 / mapView.scale} ${t.y * 1000 - (labelH / 2) / mapView.scale})`}>
                              <rect x={0} y={0}
                                width={labelW / mapView.scale} height={labelH / mapView.scale}
                                rx={3 / mapView.scale} ry={3 / mapView.scale}
                                fill="rgba(0,0,0,0.7)" stroke={slot} strokeWidth={2 / mapView.scale} />
                              <text x={(labelW / 2) / mapView.scale} y={(labelH * 0.72) / mapView.scale}
                                textAnchor="middle" fontSize={11 / mapView.scale} fontWeight={800}
                                fill="#fff" fontFamily="Manrope, sans-serif">{t.tag}</text>
                            </g>
                          </g>
                        );
                      })}
                    </svg>
                    {/* Camera viewport rectangle (kept) */}
                    <div
                      data-vp-handle
                      className={`absolute border-2 border-primary ${splitOpts.lockZoom ? "" : "cursor-move"}`}
                      style={{
                        left: `${viewport.x * 100}%`, top: `${viewport.y * 100}%`,
                        width: `${viewport.size * 100}%`, height: `${viewport.size * 100}%`,
                        boxShadow: "0 0 0 9999px rgba(0,0,0,0.35) inset",
                      }}
                      onMouseDown={(e) => { if (!splitOpts.lockZoom) { e.stopPropagation(); setVpDrag({ kind: "move", startX: e.clientX, startY: e.clientY, v: viewport }); } }}
                    >
                      {!splitOpts.lockZoom && (
                        <div data-vp-handle className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize border border-primary bg-background"
                          onMouseDown={(e) => { e.stopPropagation(); setVpDrag({ kind: "resize", startX: e.clientX, startY: e.clientY, v: viewport }); }} />
                      )}
                    </div>
                  </div>
                </div>
                {/* Zoom controls */}
                <div className="pointer-events-auto absolute right-3 bottom-3 hud-panel-strong flex flex-col overflow-hidden text-xs">
                  <button onClick={() => zoomMapBy(1.5)} className="flex h-7 w-7 items-center justify-center border-b border-border hover:bg-muted" aria-label="Zoom in">+</button>
                  <button onClick={() => zoomMapBy(1 / 1.5)} className="flex h-7 w-7 items-center justify-center border-b border-border hover:bg-muted" aria-label="Zoom out">−</button>
                  <button onClick={resetMapView} className="text-mono flex h-7 w-7 items-center justify-center text-xs hover:bg-muted" aria-label="Reset zoom">1:1</button>
                </div>
              </div>
            </div>
          </div>

          {/* Transport */}
          <div className="shrink-0 border-t border-border bg-surface px-3 py-2">
            <div className="flex items-center gap-3">
              <button onClick={togglePlay} className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">
                {playing ? "Pause" : "Play"}
              </button>
              <span className="text-mono text-xs text-muted-foreground">{fmt(time)}</span>
              <div className="relative flex-1">
                <input type="range" min={0} max={duration} step={0.05} value={time}
                  onChange={(e) => seek(Number(e.target.value))} className="w-full accent-primary" />
                {/* Event ticks on timeline */}
                <div className="pointer-events-none absolute inset-x-0 -bottom-1 h-1">
                  {events.map((ev, i) => (
                    <span key={i}
                      className="absolute top-0 h-1 w-0.5"
                      style={{ left: `${(ev.t / Math.max(duration, 0.001)) * 100}%`, background: eventColor[ev.kind] }}
                      title={`${ev.label} · ${fmt(ev.t)}`}
                    />
                  ))}
                </div>
              </div>
              <span className="text-mono text-xs text-muted-foreground">{fmt(duration)}</span>
            </div>
          </div>

          {/* Charts area (modes: graphs/debug) */}
          {showCharts && (
            <div className="min-h-0 flex-1 overflow-auto border-t border-border bg-background">
              <ChartsPanel
                time={time} duration={duration} onSeek={seek}
                events={events} showOriginal={showOriginal}
                onToggleOriginal={() => setShowOriginal((v) => !v)}
              />
              {viewMode === "debug" && <DebugPanel settings={settings} viewport={viewport} quality={quality} events={events} />}
            </div>
          )}
        </div>

        {/* Settings sidebar (always visible) */}
        <SettingsSidebar
          viewMode={viewMode}
          activeName={active.name}
          videoUrl={videoUrl} setVideoUrl={setVideoUrl}
          cropLeft={cropLeft} setCropLeft={setCropLeft}
          cropRight={cropRight} setCropRight={setCropRight}
          settings={settings} setSettings={setSettings}
          presets={presets} activePresetId={activePresetId}
          loadPreset={loadPreset}
          updateActivePreset={updateActivePreset}
          saveCurrentAsPreset={saveCurrentAsPreset}
          deleteActivePreset={deleteActivePreset}
        />
      </div>
    </div>
  );
}

/* ---------- Quality bar ---------- */
function QualityBar({ quality, preset }: {
  quality: { trackingQ: number; jumpEvents: number; lostFrames: number; avgConfidence: number };
  preset: string;
}) {
  const tone = quality.trackingQ >= 80 ? "text-emerald-400" : quality.trackingQ >= 60 ? "text-amber-400" : "text-destructive";
  return (
    <div className="flex shrink-0 items-center gap-6 border-b border-border bg-surface-2 px-6 py-2">
      <Stat label="Tracking quality" value={`${quality.trackingQ}%`} valueClass={tone} />
      <Stat label="Jump events" value={quality.jumpEvents.toString()} />
      <Stat label="Lost frames" value={quality.lostFrames.toString()} />
      <Stat label="Avg confidence" value={quality.avgConfidence.toFixed(2)} />
      <div className="ml-auto text-xs text-muted-foreground">
        preset · <span className="text-foreground">{preset}</span>
      </div>
    </div>
  );
}
function Stat({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="label-eyebrow text-xs">{label}</span>
      <span className={`text-mono text-sm font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}

/* ---------- Split controls ---------- */
function SplitControls({ opts, onChange, onReset, onFit }: {
  opts: SplitOpts;
  onChange: (next: SplitOpts) => void;
  onReset: () => void;
  onFit: () => void;
}) {
  const toggle = (k: keyof SplitOpts) => onChange({ ...opts, [k]: !opts[k] });
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-surface px-3 py-1.5">
      <span className="label-eyebrow mr-2 text-xs">Split view</span>
      <Toggle active={opts.syncMapVideo} onClick={() => toggle("syncMapVideo")}>Sync map/video</Toggle>
      <Toggle active={opts.lockZoom} onClick={() => toggle("lockZoom")}>Lock zoom</Toggle>
      <Toggle active={opts.showRingCenter} onClick={() => toggle("showRingCenter")}>Show ring center</Toggle>
      <Toggle active={opts.showCameraBbox} onClick={() => toggle("showCameraBbox")}>Show camera bbox</Toggle>
      <span className="mx-2 h-4 w-px bg-border" />
      <button onClick={onReset} className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted">Reset viewport</button>
      <button onClick={onFit} className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted">Fit map</button>
    </div>
  );
}
function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-sm border px-2 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
        active ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface-2 text-muted-foreground hover:bg-muted"
      }`}>
      {children}
    </button>
  );
}

/* ---------- Settings sidebar ---------- */
function SettingsSidebar(props: {
  viewMode: ViewMode;
  activeName: string;
  videoUrl: string; setVideoUrl: (v: string) => void;
  cropLeft: number; setCropLeft: (v: number) => void;
  cropRight: number; setCropRight: (v: number) => void;
  settings: TrackingSettings; setSettings: (v: TrackingSettings) => void;
  presets: Preset[]; activePresetId: string;
  loadPreset: (id: string) => void;
  updateActivePreset: () => void;
  saveCurrentAsPreset: () => void;
  deleteActivePreset: () => void;
}) {
  const wide = props.viewMode === "settings";
  const { settings, setSettings } = props;
  return (
    <aside className={`${wide ? "w-[420px]" : "w-80"} shrink-0 overflow-auto border-l border-border bg-surface`}>
      <div className="border-b border-border px-4 py-3">
        <div className="label-eyebrow text-xs">Camera tracking settings</div>
        <div className="mt-0.5 text-xs text-muted-foreground">Sent to backend tracker · preset: <span className="text-foreground">{props.activeName}</span></div>
      </div>

      <div className="space-y-1 p-3">
        <Collapsible title="Source" defaultOpen>
          <Field label="Video URL">
            <input value={props.videoUrl} onChange={(e) => props.setVideoUrl(e.target.value)}
              className="text-mono w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs"
              placeholder="https://…/observer.mp4" />
          </Field>
        </Collapsible>

        <Collapsible title="Crop">
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Crop L (px)" value={props.cropLeft} min={0} max={900} step={10} onChange={props.setCropLeft} />
            <NumField label="Crop R (px)" value={props.cropRight} min={0} max={900} step={10} onChange={props.setCropRight} />
          </div>
        </Collapsible>

        <Collapsible title="Smoothing / response" defaultOpen>
          <SliderField label="Smoothing" value={settings.smoothing} min={0} max={1} step={0.01}
            onChange={(v) => setSettings({ ...settings, smoothing: v })} />
          <SliderField label="Response speed" value={settings.responseSpeed} min={0} max={1} step={0.01}
            onChange={(v) => setSettings({ ...settings, responseSpeed: v })} />
          <NumField label="Deadzone (px)" value={settings.deadzone} min={0} max={200} step={1}
            onChange={(v) => setSettings({ ...settings, deadzone: v })} />
          <NumField label="Max speed (px/frame)" value={settings.maxSpeed} min={1} max={500} step={1}
            onChange={(v) => setSettings({ ...settings, maxSpeed: v })} />
          <NumField label="EMA window (frames)" value={settings.ema} min={1} max={60} step={1}
            onChange={(v) => setSettings({ ...settings, ema: v })} />
        </Collapsible>

        <Collapsible title="Zoom">
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Zoom min" value={settings.zoomMin} min={0.5} max={3} step={0.05}
              onChange={(v) => setSettings({ ...settings, zoomMin: v })} />
            <NumField label="Zoom max" value={settings.zoomMax} min={1} max={5} step={0.05}
              onChange={(v) => setSettings({ ...settings, zoomMax: v })} />
          </div>
          <NumField label="Zoom step" value={settings.zoomStep} min={0} max={1} step={0.01}
            onChange={(v) => setSettings({ ...settings, zoomStep: v })} />
          <SliderField label="Zoom lerp" value={settings.zoomLerp} min={0} max={1} step={0.01}
            onChange={(v) => setSettings({ ...settings, zoomLerp: v })} />
        </Collapsible>

        <Collapsible title="Ring / team weighting">
          <SliderField label="Ring weight" value={settings.ringWeight} min={0} max={1} step={0.01}
            onChange={(v) => setSettings({ ...settings, ringWeight: v })} />
          <SliderField label="Ring noise tolerance" value={settings.ringNoise} min={0} max={1} step={0.01}
            onChange={(v) => setSettings({ ...settings, ringNoise: v })} />
          <SliderField label="Team weight" value={settings.teamWeight} min={0} max={1} step={0.01}
            onChange={(v) => setSettings({ ...settings, teamWeight: v })} />
        </Collapsible>

        <Collapsible title="Advanced">
          <NumField label="Jump threshold (px)" value={settings.jumpThreshold} min={0} max={1000} step={5}
            onChange={(v) => setSettings({ ...settings, jumpThreshold: v })} />
          <NumField label="Pre-jump unlock (s)" value={settings.preJumpUnlock} min={0} max={3} step={0.05}
            onChange={(v) => setSettings({ ...settings, preJumpUnlock: v })} />
        </Collapsible>
      </div>

      {/* Preset manager — buttons + actions, near the settings */}
      <div className="sticky bottom-0 z-10 border-t border-border bg-surface/95 px-3 py-3 backdrop-blur">
        <div className="label-eyebrow mb-2 text-xs">Presets ({props.presets.length})</div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {props.presets.map((p) => (
            <button key={p.id} onClick={() => props.loadPreset(p.id)}
              className={`rounded-sm border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
                p.id === props.activePresetId ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface-2 text-muted-foreground hover:bg-muted"
              }`}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={props.updateActivePreset}
            className="flex-1 rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">
            Update
          </button>
          <button onClick={props.saveCurrentAsPreset}
            className="flex-1 rounded-sm border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-muted">
            Save as…
          </button>
          <button onClick={props.deleteActivePreset}
            className="rounded-sm border border-destructive/40 bg-surface-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/10">
            Delete
          </button>
        </div>
      </div>
    </aside>
  );
}

/* ---------- Collapsible ---------- */
function Collapsible({ title, defaultOpen = false, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-sm border border-border bg-surface-2">
      <button onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted">
        <span className="label-eyebrow text-xs">{title}</span>
        <span className={`text-xs text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
      </button>
      {open && <div className="space-y-2 border-t border-border px-3 py-2">{children}</div>}
    </div>
  );
}

/* ---------- Reusable inputs ---------- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="label-eyebrow mb-1 text-xs">{label}</div>{children}</div>;
}
function SliderField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-mono">{value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
    </div>
  );
}
function NumField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="label-eyebrow mb-1 text-xs">{label}</div>
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="text-mono w-full rounded-sm border border-border bg-background px-2 py-1 text-xs" />
    </div>
  );
}
function fmt(s: number) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

/* ---------- Charts panel: grouped collapsible chart sections ---------- */
function ChartsPanel({ time, duration, onSeek, events, showOriginal, onToggleOriginal }: {
  time: number; duration: number; onSeek: (t: number) => void;
  events: TrackEvent[]; showOriginal: boolean; onToggleOriginal: () => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 border-b border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1"><span className="h-2 w-3 bg-emerald-400" />smoothed</div>
        <div className="flex items-center gap-1"><span className="h-2 w-3 bg-zinc-400" />raw</div>
        <span className="mx-1 h-4 w-px bg-border" />
        {(Object.keys(eventColor) as TrackEvent["kind"][]).map((k) => (
          <div key={k} className="flex items-center gap-1">
            <span className="h-3 w-0.5" style={{ background: eventColor[k] }} />
            {eventLabel[k]}
          </div>
        ))}
        <span className="ml-auto" />
        <button onClick={onToggleOriginal}
          className={`rounded-sm border px-2 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
            showOriginal ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface-2 text-muted-foreground hover:bg-muted"
          }`}>
          {showOriginal ? "Before / After" : "After only"}
        </button>
      </div>
      <div className="space-y-2 p-2">
        <ChartGroup title="Position graphs" defaultOpen lanes={[
          { key: "x", label: "X: camera raw / smoothed", range: "484.7 … 827.0", seed: 1 },
          { key: "y", label: "Y: camera raw / smoothed", range: "334.0 … 661.0", seed: 2 },
        ]} time={time} duration={duration} onSeek={onSeek} events={events} showOriginal={showOriginal} />
        <ChartGroup title="Zoom graphs" defaultOpen lanes={[
          { key: "zoom", label: "Zoom ratio · effective", range: "-0.1 … 2.1", seed: 3 },
        ]} time={time} duration={duration} onSeek={onSeek} events={events} showOriginal={showOriginal} />
        <ChartGroup title="Ring graphs" lanes={[
          { key: "radius", label: "Ring radius · zoomedRadius", range: "139.3 … 562.7", seed: 4 },
          { key: "ring", label: "Ring number", range: "0.6 … 2.4", seed: 5 },
        ]} time={time} duration={duration} onSeek={onSeek} events={events} showOriginal={showOriginal} />
        <ChartGroup title="Jump score" lanes={[
          { key: "move", label: "moveDist · jumpScore", range: "-45.6 … 805.3", seed: 6 },
        ]} time={time} duration={duration} onSeek={onSeek} events={events} showOriginal={showOriginal} />
      </div>
    </div>
  );
}

type LaneSpec = { key: string; label: string; range: string; seed: number };
function ChartGroup({ title, lanes, time, duration, onSeek, events, showOriginal, defaultOpen = false }: {
  title: string; lanes: LaneSpec[]; time: number; duration: number;
  onSeek: (t: number) => void; events: TrackEvent[]; showOriginal: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [height, setHeight] = useState(90);
  return (
    <div className="rounded-sm border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2">
          <span className={`text-xs text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
          <span className="label-eyebrow text-xs">{title}</span>
          <span className="text-xs text-muted-foreground">· {lanes.length} lane{lanes.length === 1 ? "" : "s"}</span>
        </button>
        {open && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="label-eyebrow">H</span>
            <input type="range" min={50} max={180} step={5} value={height}
              onChange={(e) => setHeight(Number(e.target.value))} className="w-32 accent-primary" />
            <span className="text-mono w-8 text-right">{height}px</span>
          </div>
        )}
      </div>
      {open && (
        <ChartLanes lanes={lanes} height={height} time={time} duration={duration}
          onSeek={onSeek} events={events} showOriginal={showOriginal} />
      )}
    </div>
  );
}

function ChartLanes({ lanes, height, time, duration, onSeek, events, showOriginal }: {
  lanes: LaneSpec[]; height: number; time: number; duration: number;
  onSeek: (t: number) => void; events: TrackEvent[]; showOriginal: boolean;
}) {
  const W = 1200, N = 600;
  const H = height;

  const rand = (seed: number) => {
    let s = seed | 0;
    return () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 100000) / 100000; };
  };
  const sharpSeries = (seed: number) => {
    const r = rand(seed * 9973 + 1);
    const vals: number[] = []; let v = 0;
    for (let i = 0; i < N; i++) {
      if (r() < 0.04) v = (r() - 0.5) * 1.6; else v += (r() - 0.5) * 0.35;
      v = Math.max(-1, Math.min(1, v * 0.96));
      vals.push(v);
    }
    return vals;
  };
  const path = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${(i / (N - 1)) * W},${H / 2 - v * (H / 2.2)}`).join(" ");

  const totalH = lanes.length * H;
  const [hover, setHover] = useState<{ x: number; t: number; ev?: TrackEvent } | null>(null);
  const eventAtX = (xFrac: number): TrackEvent | undefined => {
    const t = xFrac * duration;
    let best: TrackEvent | undefined; let bestD = Infinity;
    for (const ev of events) {
      const d = Math.abs(ev.t - t);
      if (d < bestD && d < duration * 0.012) { bestD = d; best = ev; }
    }
    return best;
  };
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const xFrac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHover({ x: xFrac, t: xFrac * duration, ev: eventAtX(xFrac) });
  };
  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const xFrac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onSeek(xFrac * duration);
  };

  return (
    <div className="relative overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${totalH}`} className="block w-full"
        style={{ minHeight: totalH, shapeRendering: "crispEdges" }}
        onMouseMove={onMouseMove} onMouseLeave={() => setHover(null)} onClick={onClick}>
        {/* Event markers — vertical lines across all lanes */}
        {events.map((ev, i) => (
          <line key={`e-${i}`}
            x1={(ev.t / Math.max(duration, 0.001)) * W}
            x2={(ev.t / Math.max(duration, 0.001)) * W}
            y1={0} y2={totalH}
            stroke={eventColor[ev.kind]} strokeWidth={1} opacity={0.55} strokeDasharray="2 3" />
        ))}
        {lanes.map((l, idx) => {
          const a = sharpSeries(l.seed * 7 + 1);
          const b = sharpSeries(l.seed * 7 + 4).map((v) => v * 0.7);
          const y = idx * H;
          return (
            <g key={l.key} transform={`translate(0,${y})`}>
              <rect x={0} y={0} width={W} height={H} fill={idx % 2 === 0 ? "rgba(255,255,255,0.015)" : "rgba(255,255,255,0.03)"} />
              <line x1={0} y1={H} x2={W} y2={H} stroke="rgba(255,255,255,0.06)" />
              <text x={6} y={14} fill="rgba(255,255,255,0.7)" fontSize={10}>{l.label}</text>
              <text x={W - 6} y={14} textAnchor="end" fill="rgba(255,255,255,0.5)" fontSize={10}>{l.range}</text>
              {showOriginal && (
                <path d={path(b)} fill="none" stroke="#a1a1aa" strokeWidth={1} opacity={0.55} />
              )}
              <path d={path(a)} fill="none" stroke="#34d399" strokeWidth={1.2} opacity={0.95} />
            </g>
          );
        })}
        {/* Time cursor */}
        <line
          x1={(time / Math.max(duration, 0.001)) * W}
          x2={(time / Math.max(duration, 0.001)) * W}
          y1={0} y2={totalH}
          stroke="#fff" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
        {/* Hover cursor */}
        {hover && (
          <line x1={hover.x * W} x2={hover.x * W} y1={0} y2={totalH}
            stroke="#fff" strokeWidth={0.5} opacity={0.3} />
        )}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute top-1 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-foreground shadow-lg"
          style={{ left: `${hover.x * 100}%`, transform: "translateX(-50%)" }}
        >
          <span className="text-mono text-muted-foreground">{fmt(hover.t)}</span>
          {hover.ev && (
            <span className="ml-2 font-semibold" style={{ color: eventColor[hover.ev.kind] }}>{hover.ev.label}</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Debug panel ---------- */
function DebugPanel({ settings, viewport, quality, events }: {
  settings: TrackingSettings; viewport: Viewport;
  quality: { trackingQ: number; jumpEvents: number; lostFrames: number; avgConfidence: number };
  events: TrackEvent[];
}) {
  return (
    <div className="grid grid-cols-3 gap-2 p-2">
      <DebugBlock title="Settings"><pre className="text-mono text-xs leading-relaxed">{JSON.stringify(settings, null, 2)}</pre></DebugBlock>
      <DebugBlock title="Viewport"><pre className="text-mono text-xs leading-relaxed">{JSON.stringify(viewport, null, 2)}</pre></DebugBlock>
      <DebugBlock title="Quality"><pre className="text-mono text-xs leading-relaxed">{JSON.stringify(quality, null, 2)}</pre></DebugBlock>
      <DebugBlock title={`Events (${events.length})`}>
        <ul className="text-mono space-y-0.5 text-xs">
          {events.map((e, i) => (
            <li key={i}>
              <span className="text-muted-foreground">{fmt(e.t).padStart(5)}</span>{" "}
              <span style={{ color: eventColor[e.kind] }}>{e.label}</span>
            </li>
          ))}
        </ul>
      </DebugBlock>
    </div>
  );
}
function DebugBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-border bg-surface p-2">
      <div className="label-eyebrow mb-1 text-xs">{title}</div>
      {children}
    </div>
  );
}
