import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { maps as allMaps, teams as seedTeams } from "@/lib/mock-match";
import { useAdminStore } from "@/lib/admin-store";

export const Route = createFileRoute("/admin/camera")({ component: CameraAdmin });

/** Camera tracking parameters — consumed by the backend tracker. */
type TrackingSettings = {
  // Smoothing / response
  smoothing: number;          // 0..1 — EMA factor for camera position
  deadzone: number;           // px in source video where camera doesn't move
  responseSpeed: number;      // 0..1
  maxSpeed: number;           // px / frame cap
  // Zoom
  zoomMin: number;            // multiplier
  zoomMax: number;
  zoomStep: number;           // step zoom granularity
  zoomLerp: number;           // 0..1 zoom smoothing
  // Ring / weights
  ringWeight: number;         // 0..1 — bias toward ring center
  ringNoise: number;          // 0..1 — tolerated ring jitter
  teamWeight: number;         // 0..1 — bias toward alive teams centroid
  // Jump / unlock
  jumpThreshold: number;      // px movement that triggers re-lock
  preJumpUnlock: number;      // seconds before predicted jump
  // Misc
  ema: number;                // exponential moving average window (frames)
};

type Viewport = { x: number; y: number; size: number };
type Preset = {
  id: string;
  name: string;
  videoUrl: string;
  cropLeft: number;   // source pixels
  cropRight: number;  // source pixels
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

const defaultPresets: Preset[] = [
  {
    id: "p-step",
    name: "Step zoom",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    cropLeft: 420, cropRight: 420,
    viewport: { x: 0, y: 0, size: 1 },
    settings: { ...baseSettings, zoomLerp: 0.0, zoomStep: 0.25, smoothing: 0.7 },
  },
  {
    id: "p-ringnoise",
    name: "Шум кольца",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    cropLeft: 420, cropRight: 420,
    viewport: { x: 0.1, y: 0.1, size: 0.7 },
    settings: { ...baseSettings, ringWeight: 0.85, ringNoise: 0.7, teamWeight: 0.3 },
  },
  {
    id: "p-balance",
    name: "Баланс",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    cropLeft: 420, cropRight: 420,
    viewport: { x: 0.2, y: 0.2, size: 0.6 },
    settings: { ...baseSettings },
  },
  {
    id: "p-max",
    name: "Макс. чувств.",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    cropLeft: 420, cropRight: 420,
    viewport: { x: 0.3, y: 0.3, size: 0.4 },
    settings: { ...baseSettings, smoothing: 0.15, responseSpeed: 0.95, maxSpeed: 220, deadzone: 0, jumpThreshold: 60, ema: 3 },
  },
];

function CameraAdmin() {
  const { tournaments, matches } = useAdminStore();

  // Tournament → Match → Map cascade
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

  // Presets / camera state
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
        id: tm.id, tag: tm.tag, color: tm.color,
        x: 0.5 + Math.cos(a) * r,
        y: 0.5 + Math.sin(a) * r,
      };
    });
  }, [time]);

  // Shrinking ring areas — concentric rings that close in over the match duration.
  const rings = useMemo(() => {
    const t = duration > 0 ? Math.max(0, Math.min(1, time / duration)) : 0;
    // (start radius, end radius, color, label) — drift centers slightly with time.
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

  // Viewport drag/resize on map
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

  // Crop math: source is SRC_W x SRC_H, we display the center (SRC_W - cropL - cropR) x SRC_H,
  // scaled to fill the container that has aspect-ratio = visible/SRC_H.
  const visibleW = Math.max(1, SRC_W - cropLeft - cropRight);
  const visibleAspect = visibleW / SRC_H;

  return (
    <div className="flex h-full flex-col overflow-hidden">
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
        <div className="flex items-center gap-2">
          <select value={activePresetId} onChange={(e) => loadPreset(e.target.value)}
            className="rounded-sm border border-border bg-background px-2 py-1 text-xs">
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={updateActivePreset} className="rounded-sm border border-border bg-surface px-2 py-1 text-xs uppercase tracking-wider hover:bg-muted">Update</button>
          <button onClick={saveCurrentAsPreset} className="rounded-sm border border-border bg-surface px-2 py-1 text-xs uppercase tracking-wider hover:bg-muted">Save as…</button>
          <button onClick={deleteActivePreset} className="rounded-sm border border-destructive/40 bg-surface px-2 py-1 text-xs uppercase tracking-wider text-destructive hover:bg-destructive/10">Delete</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 p-3">
            {/* Video player — source 1920×1080, crop 420px each side by default */}
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
                    playsInline
                    preload="metadata"
                    crossOrigin="anonymous"
                  />
                </div>
              </div>
            </div>

            {/* Map */}
            <div className="hud-panel relative flex min-h-0 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5">
                <div className="label-eyebrow text-xs">Map · {map.name}</div>
                <div className="text-mono text-xs text-muted-foreground">viewport {(viewport.size * 100).toFixed(0)}%</div>
              </div>
              <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-background p-2">
                <div ref={mapRef} className="relative" style={{ aspectRatio: "1 / 1", height: "100%", maxWidth: "100%" }}>
                  <img src={map.image} alt={map.name} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
                  <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                    {rings.map((r, i) => (
                      <g key={`ring-${i}`}>
                        <circle
                          cx={r.cx * 1000}
                          cy={r.cy * 1000}
                          r={r.r * 1000}
                          fill="none"
                          stroke={r.color}
                          strokeWidth={2}
                          strokeDasharray="6 4"
                          opacity={0.85}
                        />
                        <circle
                          cx={r.cx * 1000}
                          cy={r.cy * 1000}
                          r={r.r * 1000}
                          fill={r.color}
                          opacity={0.06}
                        />
                        <text
                          x={r.cx * 1000}
                          y={(r.cy - r.r) * 1000 - 6}
                          textAnchor="middle"
                          fontSize={11}
                          fill={r.color}
                          stroke="#000"
                          strokeWidth={2}
                          paintOrder="stroke"
                          className="font-mono"
                        >{r.label}</text>
                      </g>
                    ))}
                    {teamPositions.map((t) => (
                      <g key={t.id}>
                        <circle cx={t.x * 1000} cy={t.y * 1000} r={10} fill={t.color} stroke="#000" strokeWidth={2} />
                        <text x={t.x * 1000} y={t.y * 1000 - 14} textAnchor="middle" fontSize={11} fill="#fff" stroke="#000" strokeWidth={3} paintOrder="stroke" className="font-mono">{t.tag}</text>
                      </g>
                    ))}
                  </svg>
                  <div
                    className="absolute border-2 border-primary"
                    style={{
                      left: `${viewport.x * 100}%`, top: `${viewport.y * 100}%`,
                      width: `${viewport.size * 100}%`, height: `${viewport.size * 100}%`,
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.35) inset", cursor: "move",
                    }}
                    onMouseDown={(e) => setVpDrag({ kind: "move", startX: e.clientX, startY: e.clientY, v: viewport })}
                  >
                    <div className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize border border-primary bg-background"
                      onMouseDown={(e) => { e.stopPropagation(); setVpDrag({ kind: "resize", startX: e.clientX, startY: e.clientY, v: viewport }); }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-surface px-3 py-2">
            <div className="flex items-center gap-3">
              <button onClick={togglePlay} className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">
                {playing ? "Pause" : "Play"}
              </button>
              <span className="text-mono text-xs text-muted-foreground">{fmt(time)}</span>
              <input type="range" min={0} max={duration} step={0.05} value={time}
                onChange={(e) => seek(Number(e.target.value))} className="flex-1 accent-primary" />
              <span className="text-mono text-xs text-muted-foreground">{fmt(duration)}</span>
            </div>
          </div>

          <OscillationChart time={time} duration={duration} onSeek={seek} />
        </div>

        {/* Tracking settings */}
        <aside className="w-80 shrink-0 overflow-auto border-l border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <div className="label-eyebrow text-xs">Camera tracking settings</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Sent to backend tracker · preset: <span className="text-foreground">{active.name}</span></div>
          </div>
          <div className="space-y-4 p-4">
            <Field label="Video URL">
              <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)}
                className="w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs text-mono"
                placeholder="https://…/observer.mp4" />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <NumField label="Crop L (px)" value={cropLeft} min={0} max={900} step={10} onChange={setCropLeft} />
              <NumField label="Crop R (px)" value={cropRight} min={0} max={900} step={10} onChange={setCropRight} />
            </div>

            <Section title="Smoothing / response">
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
            </Section>

            <Section title="Zoom">
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
            </Section>

            <Section title="Ring / team weighting">
              <SliderField label="Ring weight" value={settings.ringWeight} min={0} max={1} step={0.01}
                onChange={(v) => setSettings({ ...settings, ringWeight: v })} />
              <SliderField label="Ring noise tolerance" value={settings.ringNoise} min={0} max={1} step={0.01}
                onChange={(v) => setSettings({ ...settings, ringNoise: v })} />
              <SliderField label="Team weight" value={settings.teamWeight} min={0} max={1} step={0.01}
                onChange={(v) => setSettings({ ...settings, teamWeight: v })} />
            </Section>

            <Section title="Jump / unlock">
              <NumField label="Jump threshold (px)" value={settings.jumpThreshold} min={0} max={1000} step={5}
                onChange={(v) => setSettings({ ...settings, jumpThreshold: v })} />
              <NumField label="Pre-jump unlock (s)" value={settings.preJumpUnlock} min={0} max={3} step={0.05}
                onChange={(v) => setSettings({ ...settings, preJumpUnlock: v })} />
            </Section>

            <div className="border-t border-border pt-3">
              <div className="label-eyebrow mb-2 text-xs">Presets ({presets.length})</div>
              <ul className="space-y-1">
                {presets.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => loadPreset(p.id)} className={`w-full rounded-sm border px-2 py-1.5 text-left text-xs hover:bg-muted ${p.id === activePresetId ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface-2"}`}>
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-mono text-xs text-muted-foreground">smooth {p.settings.smoothing.toFixed(2)} · zoomLerp {p.settings.zoomLerp.toFixed(2)} · ema {p.settings.ema}</div>
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
  return <div><div className="label-eyebrow mb-1 text-xs">{label}</div>{children}</div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-3">
      <div className="label-eyebrow mb-2 text-xs">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function SliderField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground uppercase tracking-wider">{label}</span>
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
        className="w-full rounded-sm border border-border bg-background px-2 py-1 text-xs text-mono" />
    </div>
  );
}
function fmt(s: number) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

/** Multi-lane oscillation chart with sharp/jagged signals. */
function OscillationChart({ time, duration, onSeek }: { time: number; duration: number; onSeek: (t: number) => void }) {
  const lanes = useMemo(() => ([
    { key: "x",      label: "X: camera raw / smoothed",       color: "#22d3a8", color2: "#f59e0b", range: "484.7 … 827.0" },
    { key: "y",      label: "Y: camera raw / smoothed",       color: "#22d3a8", color2: "#f59e0b", range: "334.0 … 661.0" },
    { key: "zoom",   label: "Zoom ratio · effective",         color: "#22d3ee", color2: "#a5f3fc", range: "-0.1 … 2.1"   },
    { key: "radius", label: "Ring radius · zoomedRadius",     color: "#ec4899", color2: "#f9a8d4", range: "139.3 … 562.7" },
    { key: "ring",   label: "Ring number",                    color: "#94a3b8", color2: "#cbd5e1", range: "0.6 … 2.4"    },
    { key: "move",   label: "moveDist · jumpScore",           color: "#ef4444", color2: "#22c55e", range: "-45.6 … 805.3" },
  ]), []);

  const W = 1200, H = 80, N = 600;

  // Deterministic PRNG so each lane is stable but jagged.
  const rand = (seed: number) => {
    let s = seed | 0;
    return () => {
      s = (s * 1664525 + 1013904223) | 0;
      return ((s >>> 0) % 100000) / 100000;
    };
  };

  /** Sharp signal: piecewise random walk with abrupt steps. */
  const sharpSeries = (seed: number) => {
    const r = rand(seed * 9973 + 1);
    const vals: number[] = [];
    let v = 0;
    for (let i = 0; i < N; i++) {
      // occasional sudden jumps (step zoom feel)
      if (r() < 0.04) v = (r() - 0.5) * 1.6;
      else v += (r() - 0.5) * 0.35;          // jagged noise
      v = Math.max(-1, Math.min(1, v * 0.96)); // soft clamp + slight decay
      vals.push(v);
    }
    return vals;
  };

  const path = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${(i / (N - 1)) * W},${H / 2 - v * (H / 2.2)}`).join(" ");

  const onChartClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    onSeek(Math.max(0, Math.min(duration, x * duration)));
  };

  return (
    <div className="shrink-0 border-t border-border bg-background">
      <div className="flex items-center gap-4 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1"><span className="h-2 w-3 bg-zinc-500" />raw</div>
        <div className="flex items-center gap-1"><span className="h-2 w-3 bg-emerald-400" />smoothed</div>
        <div className="flex items-center gap-1"><span className="h-2 w-3 bg-amber-500" />ring center</div>
        <div className="flex items-center gap-1"><span className="h-2 w-3 bg-pink-500" />1st zoom shift</div>
        <div className="flex items-center gap-1"><span className="h-2 w-3 bg-cyan-400" />pre-jump unlock</div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${lanes.length * H + 16}`} className="block w-full" style={{ minHeight: 360, shapeRendering: "crispEdges" }} onClick={onChartClick}>
          {lanes.map((l, idx) => {
            const a = sharpSeries(idx * 7 + 1);
            const b = sharpSeries(idx * 7 + 4).map((v) => v * 0.7);
            const y = idx * H;
            return (
              <g key={l.key} transform={`translate(0,${y})`}>
                <rect x={0} y={0} width={W} height={H} fill={idx % 2 === 0 ? "rgba(255,255,255,0.015)" : "rgba(255,255,255,0.03)"} />
                <line x1={0} y1={H} x2={W} y2={H} stroke="rgba(255,255,255,0.06)" />
                <text x={6} y={14} fill="rgba(255,255,255,0.7)" fontSize={10}>{l.label}</text>
                <text x={W - 6} y={14} textAnchor="end" fill="rgba(255,255,255,0.5)" fontSize={10}>{l.range}</text>
                <path d={path(a)} fill="none" stroke={l.color}  strokeWidth={1} opacity={0.95} strokeLinejoin="miter" strokeLinecap="butt" />
                <path d={path(b)} fill="none" stroke={l.color2} strokeWidth={1} opacity={0.75} strokeLinejoin="miter" strokeLinecap="butt" />
              </g>
            );
          })}
          <line
            x1={(time / Math.max(duration, 0.001)) * W}
            x2={(time / Math.max(duration, 0.001)) * W}
            y1={0} y2={lanes.length * H}
            stroke="#fff" strokeWidth={1} strokeDasharray="3 3" opacity={0.7}
          />
        </svg>
      </div>
    </div>
  );
}