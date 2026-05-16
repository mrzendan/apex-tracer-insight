import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { maps as allMaps, teams as seedTeams } from "@/lib/mock-match";

export const Route = createFileRoute("/admin/camera")({ component: CameraAdmin });

type Viewport = { x: number; y: number; size: number }; // normalized
type Preset = {
  id: string;
  name: string;
  videoUrl: string;
  cropLeft: number;
  cropRight: number;
  mapId: string;
  viewport: Viewport;
};

const defaultPresets: Preset[] = [
  {
    id: "p-default",
    name: "Default — observer",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    cropLeft: 420,
    cropRight: 420,
    mapId: "worlds-edge",
    viewport: { x: 0, y: 0, size: 1 },
  },
  {
    id: "p-tight",
    name: "Tight zoom — endgame",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    cropLeft: 480,
    cropRight: 480,
    mapId: "storm-point",
    viewport: { x: 0.35, y: 0.35, size: 0.3 },
  },
];

function CameraAdmin() {
  const [presets, setPresets] = useState<Preset[]>(defaultPresets);
  const [activePresetId, setActivePresetId] = useState<string>(defaultPresets[0].id);
  const active = presets.find((p) => p.id === activePresetId) ?? presets[0];

  const [videoUrl, setVideoUrl] = useState(active.videoUrl);
  const [cropLeft, setCropLeft] = useState(active.cropLeft);
  const [cropRight, setCropRight] = useState(active.cropRight);
  const [mapId, setMapId] = useState(active.mapId);
  const [viewport, setViewport] = useState<Viewport>(active.viewport);

  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(60);
  const [playing, setPlaying] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const map = allMaps.find((m) => m.id === mapId) ?? allMaps[0];

  // Load preset → state
  const loadPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setActivePresetId(id);
    setVideoUrl(p.videoUrl);
    setCropLeft(p.cropLeft);
    setCropRight(p.cropRight);
    setMapId(p.mapId);
    setViewport(p.viewport);
  };

  const saveCurrentAsPreset = () => {
    const name = prompt("Preset name?");
    if (!name) return;
    const np: Preset = {
      id: `p-${Date.now()}`,
      name,
      videoUrl,
      cropLeft,
      cropRight,
      mapId,
      viewport,
    };
    setPresets((arr) => [...arr, np]);
    setActivePresetId(np.id);
  };

  const updateActivePreset = () => {
    setPresets((arr) => arr.map((p) => (p.id === activePresetId
      ? { ...p, videoUrl, cropLeft, cropRight, mapId, viewport } : p)));
  };

  const deleteActivePreset = () => {
    if (presets.length <= 1) return;
    if (!confirm(`Delete preset "${active.name}"?`)) return;
    const next = presets.filter((p) => p.id !== activePresetId);
    setPresets(next);
    setActivePresetId(next[0].id);
  };

  // Video timing
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

  // Synthetic team positions over time (orbit around center)
  const teamPositions = useMemo(() => {
    const t = time;
    return seedTeams.slice(0, 12).map((tm, i) => {
      const a = (i / 12) * Math.PI * 2 + t * 0.08;
      const r = 0.18 + ((i * 37) % 17) / 100 + Math.sin(t * 0.4 + i) * 0.04;
      return {
        id: tm.id,
        tag: tm.tag,
        color: tm.color,
        x: 0.5 + Math.cos(a) * r,
        y: 0.5 + Math.sin(a) * r,
      };
    });
  }, [time]);

  // Viewport drag/resize on map
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [vpDrag, setVpDrag] = useState<null | { kind: "move" | "resize"; startX: number; startY: number; v: Viewport }>(null);

  useEffect(() => {
    if (!vpDrag) return;
    const onMove = (e: MouseEvent) => {
      const el = mapRef.current;
      if (!el) return;
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold uppercase tracking-wider">Camera tracking</h1>
          <span className="text-mono text-[10px] text-muted-foreground">
            crop L{cropLeft}px · R{cropRight}px · viewport {(viewport.size * 100).toFixed(0)}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={activePresetId}
            onChange={(e) => loadPreset(e.target.value)}
            className="rounded-sm border border-border bg-background px-2 py-1 text-xs"
          >
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={updateActivePreset} className="rounded-sm border border-border bg-surface px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-muted">Update</button>
          <button onClick={saveCurrentAsPreset} className="rounded-sm border border-border bg-surface px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-muted">Save as…</button>
          <button onClick={deleteActivePreset} className="rounded-sm border border-destructive/40 bg-surface px-2 py-1 text-[10px] uppercase tracking-wider text-destructive hover:bg-destructive/10">Delete</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Two proportional panels */}
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 p-3">
            {/* Video player with side crops */}
            <div className="hud-panel relative flex min-h-0 flex-col overflow-hidden bg-black">
              <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5">
                <div className="label-eyebrow text-[10px]">Observer video</div>
                <div className="text-mono text-[10px] text-muted-foreground">{fmt(time)} / {fmt(duration)}</div>
              </div>
              <div className="relative flex-1 overflow-hidden bg-black">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className="absolute inset-0 h-full w-full object-contain"
                  playsInline
                  preload="metadata"
                  crossOrigin="anonymous"
                />
                {/* Crop overlays */}
                <div className="pointer-events-none absolute inset-y-0 left-0 bg-black" style={{ width: cropLeft }} />
                <div className="pointer-events-none absolute inset-y-0 right-0 bg-black" style={{ width: cropRight }} />
                <div className="pointer-events-none absolute inset-y-0 border-x border-primary/60" style={{ left: cropLeft, right: cropRight }} />
              </div>
            </div>

            {/* Map with camera viewport */}
            <div className="hud-panel relative flex min-h-0 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5">
                <div className="label-eyebrow text-[10px]">Map · {map.name}</div>
                <select
                  value={mapId}
                  onChange={(e) => setMapId(e.target.value)}
                  className="rounded-sm border border-border bg-background px-2 py-0.5 text-[10px]"
                >
                  {allMaps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-background p-2">
                <div ref={mapRef} className="relative" style={{ aspectRatio: "1 / 1", height: "100%", maxWidth: "100%" }}>
                  <img src={map.image} alt={map.name} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
                  {/* Teams */}
                  <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                    {teamPositions.map((t) => (
                      <g key={t.id}>
                        <circle cx={t.x * 1000} cy={t.y * 1000} r={10} fill={t.color} stroke="#000" strokeWidth={2} />
                        <text x={t.x * 1000} y={t.y * 1000 - 14} textAnchor="middle" fontSize={11} fill="#fff" stroke="#000" strokeWidth={3} paintOrder="stroke" className="font-mono">{t.tag}</text>
                      </g>
                    ))}
                  </svg>
                  {/* Camera viewport square */}
                  <div
                    className="absolute border-2 border-primary"
                    style={{
                      left: `${viewport.x * 100}%`,
                      top: `${viewport.y * 100}%`,
                      width: `${viewport.size * 100}%`,
                      height: `${viewport.size * 100}%`,
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.35) inset",
                      cursor: "move",
                    }}
                    onMouseDown={(e) => setVpDrag({ kind: "move", startX: e.clientX, startY: e.clientY, v: viewport })}
                  >
                    <div
                      className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize border border-primary bg-background"
                      onMouseDown={(e) => { e.stopPropagation(); setVpDrag({ kind: "resize", startX: e.clientX, startY: e.clientY, v: viewport }); }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Synced player */}
          <div className="shrink-0 border-t border-border bg-surface px-3 py-2">
            <div className="flex items-center gap-3">
              <button onClick={togglePlay} className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">
                {playing ? "Pause" : "Play"}
              </button>
              <span className="text-mono text-[10px] text-muted-foreground">{fmt(time)}</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.05}
                value={time}
                onChange={(e) => seek(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="text-mono text-[10px] text-muted-foreground">{fmt(duration)}</span>
            </div>
          </div>

          {/* Oscillation chart */}
          <OscillationChart time={time} duration={duration} onSeek={seek} />
        </div>

        {/* Settings */}
        <aside className="w-80 shrink-0 overflow-auto border-l border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <div className="label-eyebrow text-[10px]">Camera settings</div>
          </div>
          <div className="space-y-4 p-4">
            <Field label="Video URL">
              <input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                className="w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs text-mono"
                placeholder="https://…/observer.mp4"
              />
            </Field>
            <Field label={`Crop left · ${cropLeft}px`}>
              <input type="range" min={0} max={800} value={cropLeft} onChange={(e) => setCropLeft(Number(e.target.value))} className="w-full accent-primary" />
            </Field>
            <Field label={`Crop right · ${cropRight}px`}>
              <input type="range" min={0} max={800} value={cropRight} onChange={(e) => setCropRight(Number(e.target.value))} className="w-full accent-primary" />
            </Field>
            <Field label={`Viewport size · ${(viewport.size * 100).toFixed(0)}%`}>
              <input type="range" min={8} max={100} value={Math.round(viewport.size * 100)} onChange={(e) => {
                const size = Number(e.target.value) / 100;
                setViewport((v) => ({ x: Math.min(v.x, 1 - size), y: Math.min(v.y, 1 - size), size }));
              }} className="w-full accent-primary" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={`X · ${(viewport.x * 100).toFixed(0)}%`}>
                <input type="range" min={0} max={Math.round((1 - viewport.size) * 100)} value={Math.round(viewport.x * 100)}
                  onChange={(e) => setViewport((v) => ({ ...v, x: Number(e.target.value) / 100 }))} className="w-full accent-primary" />
              </Field>
              <Field label={`Y · ${(viewport.y * 100).toFixed(0)}%`}>
                <input type="range" min={0} max={Math.round((1 - viewport.size) * 100)} value={Math.round(viewport.y * 100)}
                  onChange={(e) => setViewport((v) => ({ ...v, y: Number(e.target.value) / 100 }))} className="w-full accent-primary" />
              </Field>
            </div>
            <div className="border-t border-border pt-3">
              <div className="label-eyebrow mb-2 text-[10px]">Presets ({presets.length})</div>
              <ul className="space-y-1">
                {presets.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => loadPreset(p.id)} className={`w-full rounded-sm border px-2 py-1.5 text-left text-xs hover:bg-muted ${p.id === activePresetId ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface-2"}`}>
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-mono text-[10px] text-muted-foreground">{p.mapId} · L{p.cropLeft} R{p.cropRight} · {(p.viewport.size * 100).toFixed(0)}%</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label-eyebrow mb-1 text-[10px]">{label}</div>
      {children}
    </div>
  );
}

function fmt(s: number) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

/** Multi-lane oscillation chart matching the reference screenshot. */
function OscillationChart({ time, duration, onSeek }: { time: number; duration: number; onSeek: (t: number) => void }) {
  const lanes = useMemo(() => ([
    { key: "x", label: "X: camera raw / smoothed", color: "#22d3a8", color2: "#f59e0b", range: "484.7 … 827.0" },
    { key: "y", label: "Y: camera raw / smoothed", color: "#22d3a8", color2: "#f59e0b", range: "334.0 … 661.0" },
    { key: "zoom", label: "Zoom ratio · effective", color: "#22d3ee", color2: "#22d3ee", range: "-0.1 … 2.1" },
    { key: "radius", label: "Ring radius · zoomedRadius", color: "#ec4899", color2: "#ec4899", range: "139.3 … 562.7" },
    { key: "ring", label: "Ring number", color: "#94a3b8", color2: "#94a3b8", range: "0.6 … 2.4" },
    { key: "move", label: "moveDist · jumpScore", color: "#ef4444", color2: "#22c55e", range: "-45.6 … 805.3" },
  ]), []);

  const W = 1200, H = 80, N = 240;
  const series = (seed: number) => Array.from({ length: N }, (_, i) => {
    const t = i / N;
    return Math.sin(t * 12 + seed) * 0.3 + Math.sin(t * 47 + seed * 2) * 0.15 + Math.sin(t * 5 + seed * 3) * 0.25;
  });
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${(i / (N - 1)) * W},${H / 2 - v * (H / 2.2)}`).join(" ");

  const onChartClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    onSeek(Math.max(0, Math.min(duration, x * duration)));
  };

  return (
    <div className="shrink-0 border-t border-border bg-background">
      <div className="flex items-center gap-4 border-b border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1"><span className="h-2 w-3 bg-zinc-500" />raw</div>
        <div className="flex items-center gap-1"><span className="h-2 w-3 bg-emerald-400" />smoothed</div>
        <div className="flex items-center gap-1"><span className="h-2 w-3 bg-amber-500" />ring center</div>
        <div className="flex items-center gap-1"><span className="h-2 w-3 bg-pink-500" />1st zoom shift</div>
        <div className="flex items-center gap-1"><span className="h-2 w-3 bg-cyan-400" />pre-jump unlock</div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${lanes.length * H + 16}`} className="block w-full" style={{ minHeight: 360 }} onClick={onChartClick}>
          {lanes.map((l, idx) => {
            const a = series(idx * 7 + 1);
            const b = series(idx * 7 + 4).map((v) => v * 0.7);
            const y = idx * H;
            return (
              <g key={l.key} transform={`translate(0,${y})`}>
                <rect x={0} y={0} width={W} height={H} fill={idx % 2 === 0 ? "rgba(255,255,255,0.015)" : "rgba(255,255,255,0.03)"} />
                <line x1={0} y1={H} x2={W} y2={H} stroke="rgba(255,255,255,0.06)" />
                <text x={6} y={14} fill="rgba(255,255,255,0.7)" fontSize={10}>{l.label}</text>
                <text x={W - 6} y={14} textAnchor="end" fill="rgba(255,255,255,0.5)" fontSize={10}>{l.range}</text>
                <path d={path(a)} fill="none" stroke={l.color} strokeWidth={1.2} opacity={0.9} />
                <path d={path(b)} fill="none" stroke={l.color2} strokeWidth={1.2} opacity={0.7} />
              </g>
            );
          })}
          {/* Playhead */}
          <line
            x1={(time / Math.max(duration, 0.001)) * W}
            x2={(time / Math.max(duration, 0.001)) * W}
            y1={0}
            y2={lanes.length * H}
            stroke="#fff"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.7}
          />
        </svg>
      </div>
    </div>
  );
}