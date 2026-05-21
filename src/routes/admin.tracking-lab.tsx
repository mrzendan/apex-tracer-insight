import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/admin/tracking-lab")({
  component: TrackingLabPage,
});

// ----- types matching scripts/tracking/schema/tracks.schema.json -----
type TrackState = "alive" | "low_conf" | "lost";
type Registration = "ok" | "low_confidence" | "failed";
type TeamMeta = { id: string; name?: string; color?: string };
type FrameTrack = {
  team_id: string;
  world: [number, number];
  canonical_px?: [number, number];
  frame_px?: [number, number];
  angle_world_deg?: number | null;
  state: TrackState;
  confidence?: number;
};
type Frame = {
  t: number;
  frame: number;
  camera: {
    registration: Registration;
    ransac_inliers?: number;
    zoom?: number;
    rotation_deg?: number;
    pan_canonical?: [number, number];
  };
  tracks: FrameTrack[];
};
type TracksFile = {
  meta: {
    video: string;
    fps_source: number;
    fps_processed: number;
    frame_count: number;
    canonical_map: string;
    canonical_size: [number, number];
    world_bounds: { x: [number, number]; y: [number, number] };
    teams?: TeamMeta[];
    schema_version: number;
  };
  frames: Frame[];
};

const DEFAULT_PALETTE = ["#ef4444", "#3b82f6", "#eab308", "#22c55e", "#a855f7", "#ec4899", "#06b6d4", "#f97316"];

type GtAnchor = { t: number; slot_id: string; world_xy: [number, number] };

function TrackingLabPage() {
  const [data, setData] = useState<TracksFile | null>(null);
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hiddenTeams, setHiddenTeams] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [gtMode, setGtMode] = useState(false);
  const [gtSlot, setGtSlot] = useState<string>("");
  const [gtAnchors, setGtAnchors] = useState<GtAnchor[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);

  // teams meta with colors
  const teamMeta = useMemo<Record<string, TeamMeta & { color: string }>>(() => {
    if (!data) return {};
    const map: Record<string, TeamMeta & { color: string }> = {};
    const explicit = data.meta.teams ?? [];
    const seen = new Set<string>();
    explicit.forEach((t, i) => {
      map[t.id] = { ...t, color: t.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length] };
      seen.add(t.id);
    });
    let idx = explicit.length;
    for (const f of data.frames) for (const t of f.tracks) {
      if (!seen.has(t.team_id)) {
        map[t.team_id] = { id: t.team_id, color: DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length] };
        seen.add(t.team_id); idx++;
      }
    }
    return map;
  }, [data]);

  const frame = data?.frames[Math.min(frameIdx, (data?.frames.length ?? 1) - 1)] ?? null;

  // file loading
  const onTracksFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const txt = await file.text();
      const parsed = JSON.parse(txt) as TracksFile;
      if (!parsed.meta || !parsed.frames) throw new Error("файл не похож на tracks.json");
      setData(parsed);
      setFrameIdx(0);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Не удалось прочитать ${file.name}: ${msg}`);
    }
  }, []);

  const onVideoFile = useCallback((file: File) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
  }, [videoUrl]);

  const onMapFile = useCallback((file: File) => {
    if (mapUrl) URL.revokeObjectURL(mapUrl);
    setMapUrl(URL.createObjectURL(file));
  }, [mapUrl]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    for (const f of Array.from(e.dataTransfer.files)) {
      if (f.name.endsWith(".json")) onTracksFile(f);
      else if (f.type.startsWith("video/")) onVideoFile(f);
      else if (f.type.startsWith("image/")) onMapFile(f);
    }
  }, [onTracksFile, onVideoFile, onMapFile]);

  // canvas click → add GT anchor (only in gtMode)
  const onCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!gtMode || !data || !frame) return;
    if (!gtSlot) { setError("Выбери слот в правой панели перед кликом по карте"); return; }
    const cnv = e.currentTarget;
    const rect = cnv.getBoundingClientRect();
    const cw = cnv.width, ch = cnv.height;
    const dw = rect.width, dh = rect.height;
    const scale = Math.min(dw / cw, dh / ch);
    const sw = cw * scale, sh = ch * scale;
    const ox = (dw - sw) / 2, oy = (dh - sh) / 2;
    const px = (e.clientX - rect.left - ox) / scale;
    const py = (e.clientY - rect.top - oy) / scale;
    if (px < 0 || py < 0 || px > cw || py > ch) return;
    setError(null);
    setGtAnchors((prev) => [...prev, {
      t: +frame.t.toFixed(2),
      slot_id: gtSlot,
      world_xy: [Math.round(px), Math.round(py)],
    }]);
  }, [gtMode, gtSlot, data, frame]);

  const exportGtJson = useCallback(() => {
    if (!data) return;
    const payload = {
      _note: "GT anchors for ID-switch evaluation. Merge into scripts/tracking/modules/track_teams/assets/gt_anchors.json",
      video: data.meta.video,
      points: gtAnchors,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "gt_anchors.json"; a.click();
    URL.revokeObjectURL(url);
  }, [data, gtAnchors]);

  // playback loop
  useEffect(() => {
    if (!playing || !data) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setFrameIdx((i) => {
        const next = i + speed * Math.max(1, Math.round(data.meta.fps_processed * dt));
        if (next >= data.frames.length - 1) { setPlaying(false); return data.frames.length - 1; }
        return Math.floor(next);
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, data, speed]);

  // sync video to frame
  useEffect(() => {
    if (!data || !videoRef.current || !frame) return;
    const v = videoRef.current;
    const target = frame.frame / data.meta.fps_source;
    if (Math.abs(v.currentTime - target) > 0.15) v.currentTime = target;
  }, [frame, data]);

  // canvas render
  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv || !data) return;
    const ctx = cnv.getContext("2d");
    if (!ctx) return;
    const [W, H] = data.meta.canonical_size;
    cnv.width = W; cnv.height = H;
    ctx.clearRect(0, 0, W, H);
    // background
    if (mapUrl) {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, W, H); drawOverlay(); };
      img.src = mapUrl;
    } else {
      ctx.fillStyle = "#0b0f17"; ctx.fillRect(0, 0, W, H);
      // grid
      ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 2;
      const step = Math.max(W, H) / 20;
      for (let x = 0; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      drawOverlay();
    }

    function drawOverlay() {
      if (!ctx || !frame) return;
      // observer viewport (rough rectangle from pan + zoom). pan is canonical px of frame center; viewport size ≈ frame_size / zoom.
      if (frame.camera.pan_canonical && frame.camera.zoom && frame.camera.zoom > 0) {
        // approximate viewport using 1920x1080 source frame
        const vw = 1920 / frame.camera.zoom;
        const vh = 1080 / frame.camera.zoom;
        const [cx, cy] = frame.camera.pan_canonical;
        ctx.strokeStyle = frame.camera.registration === "ok" ? "rgba(34,197,94,0.7)" : "rgba(234,179,8,0.7)";
        ctx.lineWidth = 6;
        ctx.strokeRect(cx - vw / 2, cy - vh / 2, vw, vh);
      }
      // team tracks
      for (const t of frame.tracks) {
        if (hiddenTeams.has(t.team_id)) continue;
        if (!t.canonical_px) continue;
        const meta = teamMeta[t.team_id];
        const color = meta?.color ?? "#fff";
        const [x, y] = t.canonical_px;
        const r = 28;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color + (t.state === "alive" ? "cc" : "55");
        ctx.fill();
        ctx.strokeStyle = "#000"; ctx.lineWidth = 3; ctx.stroke();
        if (t.angle_world_deg != null) {
          const a = (t.angle_world_deg * Math.PI) / 180;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a) * r * 1.8, y + Math.sin(a) * r * 1.8);
          ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.stroke();
        }
        ctx.fillStyle = "#000";
        ctx.font = "bold 28px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText(t.team_id, x, y + 10);
      }
      // GT anchors overlay (all of them, highlight current slot)
      for (const a of gtAnchors) {
        const meta = teamMeta[a.slot_id];
        const color = meta?.color ?? "#ffffff";
        const [x, y] = a.world_xy;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = a.slot_id === gtSlot ? "#fff" : "#000";
        ctx.lineWidth = a.slot_id === gtSlot ? 4 : 2;
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 14px ui-sans-serif, system-ui";
        ctx.textAlign = "left";
        ctx.fillText(`${a.slot_id} @${a.t.toFixed(1)}s`, x + 14, y + 5);
      }
    }
  }, [data, frame, mapUrl, hiddenTeams, teamMeta, gtAnchors, gtSlot]);

  // analytics aggregates
  const zoomSeries = useMemo(() => data?.frames.map((f) => f.camera.zoom ?? 0) ?? [], [data]);
  const inlierSeries = useMemo(() => data?.frames.map((f) => f.camera.ransac_inliers ?? 0) ?? [], [data]);
  const lowConfCount = useMemo(() => data?.frames.filter((f) => f.camera.registration !== "ok").length ?? 0, [data]);

  const exportCsv = useCallback(() => {
    if (!data) return;
    const rows = ["t,frame,team_id,world_x,world_y,canonical_x,canonical_y,angle,state,zoom,reg"];
    for (const f of data.frames) {
      for (const t of f.tracks) {
        rows.push([
          f.t, f.frame, t.team_id,
          t.world[0], t.world[1],
          t.canonical_px?.[0] ?? "", t.canonical_px?.[1] ?? "",
          t.angle_world_deg ?? "", t.state,
          f.camera.zoom ?? "", f.camera.registration,
        ].join(","));
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "tracks.csv"; a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  return (
    <div className="flex h-full min-h-0 flex-col" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <div className="text-sm font-bold uppercase tracking-wider">Tracking Lab</div>
        <div className="label-eyebrow text-xs text-muted-foreground">VOD → tracks.json → визуализация</div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <FileButton label="tracks.json" accept=".json,application/json" onFile={onTracksFile} />
          <FileButton label="canonical map" accept="image/*" onFile={onMapFile} />
          <FileButton label="video (opt)" accept="video/*" onFile={onVideoFile} />
          <button onClick={exportCsv} disabled={!data}
            className="rounded-sm border border-border bg-muted px-3 py-1.5 font-semibold uppercase tracking-wider hover:bg-muted/80 disabled:opacity-40">
            Export CSV
          </button>
        </div>
      </header>

      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>
      )}

      {!data ? (
        <EmptyState />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] overflow-hidden">
          <div className="relative flex min-h-0 flex-col overflow-hidden bg-black">
            <div className="relative flex-1 overflow-hidden">
              <canvas
                ref={canvasRef}
                onClick={onCanvasClick}
                className={`absolute inset-0 h-full w-full object-contain ${gtMode ? "cursor-crosshair" : ""}`}
              />
              {gtMode && (
                <div className="absolute left-3 top-3 rounded-sm border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                  GT picker · slot: {gtSlot || "—"} · добавлено: {gtAnchors.length}
                </div>
              )}
              {videoUrl && (
                <video ref={videoRef} src={videoUrl} muted className="absolute bottom-3 right-3 h-44 w-auto rounded border border-border opacity-90" />
              )}
            </div>
            <Timeline
              frames={data.frames}
              frameIdx={frameIdx}
              setFrameIdx={setFrameIdx}
              playing={playing}
              setPlaying={setPlaying}
              speed={speed}
              setSpeed={setSpeed}
            />
          </div>

          <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-border bg-surface p-3 text-xs">
            <MetaBox data={data} frame={frame} lowConfCount={lowConfCount} />
            <GtPickerBox
              gtMode={gtMode}
              setGtMode={setGtMode}
              gtSlot={gtSlot}
              setGtSlot={setGtSlot}
              gtAnchors={gtAnchors}
              setGtAnchors={setGtAnchors}
              exportGtJson={exportGtJson}
              teamMeta={teamMeta}
            />
            <TeamsBox
              teamMeta={teamMeta}
              hidden={hiddenTeams}
              setHidden={setHiddenTeams}
              frame={frame}
              gtMode={gtMode}
              gtSlot={gtSlot}
              setGtSlot={setGtSlot}
            />
            <Sparkline label="zoom" values={zoomSeries} cursor={frameIdx} color="#22d3ee" />
            <Sparkline label="ransac inliers" values={inlierSeries} cursor={frameIdx} color="#a855f7" />
          </aside>
        </div>
      )}
    </div>
  );
}

function FileButton({ label, accept, onFile }: { label: string; accept: string; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button onClick={() => ref.current?.click()}
        className="rounded-sm border border-border bg-muted px-3 py-1.5 font-semibold uppercase tracking-wider hover:bg-muted/80">
        {label}
      </button>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="max-w-xl rounded-sm border border-dashed border-border bg-surface p-8 text-center text-sm text-muted-foreground">
        <div className="mb-2 text-base font-semibold text-foreground">Перетащи сюда tracks.json</div>
        <div className="mb-4">Опционально — каноническая карта (PNG) и само видео матча (MP4) для синхронной отрисовки.</div>
        <div className="text-xs">Запусти скрипт: <code className="rounded bg-muted px-1.5 py-0.5">python scripts/tracking/track_teams.py --video game.mp4 --config scripts/tracking/config.example.yaml --out tracks.json</code></div>
      </div>
    </div>
  );
}

function MetaBox({ data, frame, lowConfCount }: { data: TracksFile; frame: Frame | null; lowConfCount: number }) {
  return (
    <div className="rounded-sm border border-border bg-background p-3">
      <div className="label-eyebrow mb-2 text-xs text-muted-foreground">Source</div>
      <Row k="video" v={data.meta.video} />
      <Row k="frames" v={`${data.frames.length} @ ${data.meta.fps_processed.toFixed(1)} fps`} />
      <Row k="map" v={`${data.meta.canonical_map} (${data.meta.canonical_size.join("×")})`} />
      <Row k="low conf" v={`${lowConfCount} (${((lowConfCount / data.frames.length) * 100).toFixed(0)}%)`} />
      {frame && (
        <>
          <div className="label-eyebrow mb-1 mt-3 text-xs text-muted-foreground">Frame</div>
          <Row k="t" v={`${frame.t.toFixed(2)}s · #${frame.frame}`} />
          <Row k="reg" v={frame.camera.registration} />
          <Row k="zoom" v={frame.camera.zoom?.toFixed(3) ?? "—"} />
          <Row k="pan" v={frame.camera.pan_canonical ? `${Math.round(frame.camera.pan_canonical[0])}, ${Math.round(frame.camera.pan_canonical[1])}` : "—"} />
          <Row k="rot" v={frame.camera.rotation_deg != null ? `${frame.camera.rotation_deg.toFixed(1)}°` : "—"} />
          <Row k="inliers" v={frame.camera.ransac_inliers?.toString() ?? "—"} />
        </>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-mono truncate font-mono text-foreground">{v}</span>
    </div>
  );
}

function TeamsBox({
  teamMeta, hidden, setHidden, frame, gtMode, gtSlot, setGtSlot,
}: {
  teamMeta: Record<string, TeamMeta & { color: string }>;
  hidden: Set<string>;
  setHidden: (s: Set<string>) => void;
  frame: Frame | null;
  gtMode: boolean;
  gtSlot: string;
  setGtSlot: (s: string) => void;
}) {
  const teams = Object.values(teamMeta);
  if (teams.length === 0) return null;
  const stateById = new Map(frame?.tracks.map((t) => [t.team_id, t.state] as const) ?? []);
  return (
    <div className="rounded-sm border border-border bg-background p-3">
      <div className="label-eyebrow mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>Teams</span>
        <span className="normal-case tracking-normal">
          {gtMode ? "клик по строке = выбрать слот · глаз = скрыть" : "клик по глазу = скрыть на карте"}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {teams.map((t) => {
          const isHidden = hidden.has(t.id);
          const st = stateById.get(t.id);
          const isSelected = gtMode && gtSlot === t.id;
          return (
            <div
              key={t.id}
              onClick={() => { if (gtMode) setGtSlot(t.id); }}
              className={`flex items-center justify-between rounded-sm border px-2 py-1 text-left ${
                isSelected ? "border-primary bg-primary/15" : "border-border"
              } ${isHidden ? "opacity-40" : ""} ${gtMode ? "cursor-pointer" : ""}`}
            >
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: t.color }} />
                <span className="font-semibold">{t.name ?? t.id}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-mono text-xs text-muted-foreground">{st ?? "—"}</span>
                <button
                  type="button"
                  title={isHidden ? "Показать" : "Скрыть"}
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = new Set(hidden);
                    if (isHidden) next.delete(t.id); else next.add(t.id);
                    setHidden(next);
                  }}
                  className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-xs hover:bg-muted/70"
                >
                  {isHidden ? "👁‍🗨" : "👁"}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GtPickerBox({
  gtMode, setGtMode, gtSlot, setGtSlot, gtAnchors, setGtAnchors, exportGtJson, teamMeta,
}: {
  gtMode: boolean;
  setGtMode: (b: boolean) => void;
  gtSlot: string;
  setGtSlot: (s: string) => void;
  gtAnchors: GtAnchor[];
  setGtAnchors: (a: GtAnchor[]) => void;
  exportGtJson: () => void;
  teamMeta: Record<string, TeamMeta & { color: string }>;
}) {
  const teamIds = Object.keys(teamMeta).sort();
  const importRef = useRef<HTMLInputElement>(null);

  const onImport = (file: File, mode: "replace" | "merge") => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const rawPoints = Array.isArray(parsed) ? parsed : parsed?.points;
        if (!Array.isArray(rawPoints)) throw new Error("ожидался массив points");
        const cleaned: GtAnchor[] = [];
        for (const p of rawPoints) {
          if (
            p && typeof p.slot_id === "string" &&
            typeof p.t === "number" &&
            Array.isArray(p.world_xy) && p.world_xy.length === 2 &&
            typeof p.world_xy[0] === "number" && typeof p.world_xy[1] === "number"
          ) {
            cleaned.push({ t: p.t, slot_id: p.slot_id, world_xy: [p.world_xy[0], p.world_xy[1]] });
          }
        }
        if (!cleaned.length) throw new Error("в файле нет валидных точек");
        if (mode === "replace") {
          setGtAnchors(cleaned);
        } else {
          const key = (a: GtAnchor) => `${a.slot_id}|${a.t.toFixed(2)}|${a.world_xy[0]}|${a.world_xy[1]}`;
          const seen = new Set(gtAnchors.map(key));
          const merged = [...gtAnchors];
          for (const a of cleaned) if (!seen.has(key(a))) merged.push(a);
          setGtAnchors(merged);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // eslint-disable-next-line no-alert
        window.alert(`Не удалось импортировать gt_anchors.json: ${msg}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="rounded-sm border border-border bg-background p-3">
      <div className="label-eyebrow mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>GT picker</span>
        <button
          onClick={() => setGtMode(!gtMode)}
          className={`rounded-sm border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${
            gtMode ? "border-primary bg-primary/20 text-primary" : "border-border bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          {gtMode ? "on" : "off"}
        </button>
      </div>
      {gtMode && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground">
            1) выбери слот ниже или в списке Teams · 2) скрабь таймлайн · 3) кликай по позиции команды на карте
          </div>
          <select
            value={gtSlot}
            onChange={(e) => setGtSlot(e.target.value)}
            className="rounded-sm border border-border bg-muted px-2 py-1 text-xs"
          >
            <option value="">— выбери слот —</option>
            {teamIds.map((id) => (
              <option key={id} value={id}>{teamMeta[id]?.name ?? id} ({id})</option>
            ))}
          </select>
          <div className="flex items-center justify-between gap-2">
            <span className="text-mono text-xs">точек: {gtAnchors.length}</span>
            <div className="flex gap-1">
              <button
                onClick={() => setGtAnchors(gtAnchors.slice(0, -1))}
                disabled={!gtAnchors.length}
                className="rounded-sm border border-border bg-muted px-2 py-0.5 text-xs hover:bg-muted/70 disabled:opacity-40"
              >
                undo
              </button>
              <button
                onClick={() => setGtAnchors([])}
                disabled={!gtAnchors.length}
                className="rounded-sm border border-border bg-muted px-2 py-0.5 text-xs hover:bg-muted/70 disabled:opacity-40"
              >
                clear
              </button>
              <button
                onClick={exportGtJson}
                disabled={!gtAnchors.length}
                className="rounded-sm border border-primary/40 bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary/25 disabled:opacity-40"
              >
                export json
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
            <span className="text-xs text-muted-foreground">import gt_anchors.json</span>
            <div className="flex gap-1">
              <button
                onClick={() => { importRef.current?.dataset.mode = "merge"; importRef.current?.click(); }}
                className="rounded-sm border border-border bg-muted px-2 py-0.5 text-xs hover:bg-muted/70"
                title="Добавить точки из файла к текущим (без дубликатов)"
              >
                merge
              </button>
              <button
                onClick={() => { importRef.current?.dataset.mode = "replace"; importRef.current?.click(); }}
                className="rounded-sm border border-border bg-muted px-2 py-0.5 text-xs hover:bg-muted/70"
                title="Заменить текущие точки на содержимое файла"
              >
                replace
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  const mode = (e.target.dataset.mode as "merge" | "replace") || "merge";
                  if (f) onImport(f, mode);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Sparkline({ label, values, cursor, color }: { label: string; values: number[]; cursor: number; color: string }) {
  if (values.length === 0) return null;
  const w = 280, h = 60;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const cx = (cursor / Math.max(1, values.length - 1)) * w;
  return (
    <div className="rounded-sm border border-border bg-background p-3">
      <div className="label-eyebrow mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="text-mono">{values[cursor]?.toFixed(2) ?? "—"} (min {min.toFixed(2)} / max {max.toFixed(2)})</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full">
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
        <line x1={cx} x2={cx} y1={0} y2={h} stroke="#fff" strokeOpacity={0.4} strokeWidth={1} />
      </svg>
    </div>
  );
}

function Timeline({
  frames, frameIdx, setFrameIdx, playing, setPlaying, speed, setSpeed,
}: {
  frames: Frame[]; frameIdx: number; setFrameIdx: (n: number) => void;
  playing: boolean; setPlaying: (b: boolean) => void;
  speed: number; setSpeed: (n: number) => void;
}) {
  const f = frames[frameIdx];
  return (
    <div className="flex h-20 shrink-0 items-center gap-3 border-t border-border bg-surface px-3">
      <button onClick={() => setPlaying(!playing)}
        className="rounded-sm border border-border bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-muted/80">
        {playing ? "Pause" : "Play"}
      </button>
      <div className="flex items-center gap-1 text-xs">
        {[0.5, 1, 2, 4].map((s) => (
          <button key={s} onClick={() => setSpeed(s)}
            className={`rounded-sm border px-2 py-1 text-mono ${speed === s ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-muted text-muted-foreground hover:text-foreground"}`}>
            {s}x
          </button>
        ))}
      </div>
      <input
        type="range" min={0} max={frames.length - 1} value={frameIdx}
        onChange={(e) => setFrameIdx(parseInt(e.target.value, 10))}
        className="flex-1 accent-primary"
      />
      <div className="w-40 text-right text-xs font-mono text-muted-foreground">
        {f ? `${f.t.toFixed(2)}s · ${frameIdx + 1}/${frames.length}` : "—"}
      </div>
    </div>
  );
}