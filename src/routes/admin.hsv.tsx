import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { teams } from "@/lib/mock-match";
import worldsEdgeSample from "@/assets/hsv-samples/worlds-edge.png";
import stormPointSample from "@/assets/hsv-samples/storm-point.png";
import eDistrictSample from "@/assets/hsv-samples/e-district.png";
import olympusSample from "@/assets/hsv-samples/olympus.png";

export const Route = createFileRoute("/admin/hsv")({
  component: HsvAdmin,
  validateSearch: (s: Record<string, unknown>) => ({
    mapId: typeof s.mapId === "string" ? s.mapId : undefined,
  }),
});

type Range3 = [number, number];
type Preset = { h: Range3; s: Range3; v: Range3 };
type PickedColor = { r: number; g: number; b: number; h: number; s: number; v: number };

type Frame = { id: string; name: string; image: string };

const DEFAULT_FRAMES: Frame[] = [
  { id: "worlds-edge", name: "World's Edge", image: worldsEdgeSample },
  { id: "storm-point", name: "Storm Point", image: stormPointSample },
  { id: "e-district",  name: "E-District",  image: eDistrictSample },
  { id: "olympus",     name: "Olympus",     image: olympusSample },
];

function rgbToHsvCv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
  }
  h = Math.round((h * 60) / 2);
  if (h < 0) h += 180;
  const s = max === 0 ? 0 : Math.round((d / max) * 255);
  const v = Math.round(max * 255);
  return [h, s, v];
}

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

function presetFromColor(color: string): Preset {
  const [r, g, b] = hexToRgb(color);
  const [h, s, v] = rgbToHsvCv(r, g, b);
  return rangesAround(h, s, v);
}

function rangesAround(h: number, s: number, v: number): Preset {
  return {
    h: [Math.max(0, h - 10), Math.min(179, h + 10)],
    s: [Math.max(0, s - 60), Math.min(255, s + 40)],
    v: [Math.max(40, v - 60), Math.min(255, v + 40)],
  };
}

function hsvCvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = (h * 2) / 60;
  const ss = s / 255;
  const vv = v / 255;
  const c = vv * ss;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = vv - c;
  let r = 0, g = 0, b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function presetCenterHex(p: Preset): string {
  const h = Math.round((p.h[0] + p.h[1]) / 2);
  const s = Math.round((p.s[0] + p.s[1]) / 2);
  const v = Math.round((p.v[0] + p.v[1]) / 2);
  const [r, g, b] = hsvCvToRgb(h, s, v);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function rangeOverlap(a: Range3, b: Range3): number {
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return Math.max(0, hi - lo);
}
function rangeWidth(a: Range3): number {
  return Math.max(1, a[1] - a[0]);
}
/** Volumetric overlap of two HSV cuboids, as % of the smaller one. */
function presetOverlap(a: Preset, b: Preset): number {
  const oh = rangeOverlap(a.h, b.h);
  const os = rangeOverlap(a.s, b.s);
  const ov = rangeOverlap(a.v, b.v);
  if (oh === 0 || os === 0 || ov === 0) return 0;
  const vol = oh * os * ov;
  const va = rangeWidth(a.h) * rangeWidth(a.s) * rangeWidth(a.v);
  const vb = rangeWidth(b.h) * rangeWidth(b.s) * rangeWidth(b.v);
  return Math.round((vol / Math.min(va, vb)) * 100);
}

function HsvAdmin() {
  const teamList = useMemo(
    () => teams.map((t, i) => ({ ...t, displayName: `Team ${i + 1}` })),
    [],
  );

  // Presets are stored per (team, frame) so each map keeps its own calibration.
  const presetKey = (tid: string, fid: string) => `${tid}|${fid}`;
  const [presets, setPresets] = useState<Record<string, Preset>>(() => {
    const init: Record<string, Preset> = {};
    for (const t of teams) for (const f of DEFAULT_FRAMES) init[presetKey(t.id, f.id)] = presetFromColor(t.color);
    return init;
  });
  const [savedColors, setSavedColors] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const t of teams) for (const f of DEFAULT_FRAMES) init[presetKey(t.id, f.id)] = t.color;
    return init;
  });

  const [frames, setFrames] = useState<Frame[]>(DEFAULT_FRAMES);
  const [frameId, setFrameId] = useState<string>(DEFAULT_FRAMES[0].id);
  const [teamId, setTeamId] = useState(teamList[0].id);
  const [history, setHistory] = useState<PickedColor[]>([]);
  const [lastPick, setLastPick] = useState<PickedColor | null>(null);
  const [compareAll, setCompareAll] = useState(false);
  const [showDevSnippet, setShowDevSnippet] = useState(false);
  const [maskStats, setMaskStats] = useState<{ detected: number; total: number; overlapPct: number }>({
    detected: 0, total: 1, overlapPct: 0,
  });

  const team = teamList.find((t) => t.id === teamId)!;
  const frame = frames.find((f) => f.id === frameId) ?? frames[0];
  const k = presetKey(teamId, frame.id);
  const preset = presets[k] ?? presetFromColor(team.color);
  const teamSwatch = (id: string) =>
    savedColors[presetKey(id, frame.id)] ?? teamList.find((t) => t.id === id)!.color;

  const setPreset = (p: Partial<Preset>) =>
    setPresets((prev) => ({ ...prev, [k]: { ...(prev[k] ?? preset), ...p } }));

  // Compute conflicts vs other teams.
  const conflicts = useMemo(() => {
    return teamList
      .filter((t) => t.id !== teamId)
      .map((t) => ({ team: t, pct: presetOverlap(preset, presets[presetKey(t.id, frame.id)] ?? presetFromColor(t.color)) }))
      .filter((c) => c.pct >= 5)
      .sort((a, b) => b.pct - a.pct);
  }, [presets, preset, teamList, teamId, frame.id]);

  // Sample canvas (full resolution offscreen) for eyedropper sampling
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imgReady, setImgReady] = useState(false);

  useEffect(() => {
    setImgReady(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = frame.image;
    img.onload = () => {
      const W = 640;
      const H = Math.round((img.height / img.width) * W);
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      const ctx = off.getContext("2d")!;
      ctx.drawImage(img, 0, 0, W, H);
      sampleCanvasRef.current = off;
      const pv = previewRef.current;
      if (pv) {
        pv.width = W; pv.height = H;
        pv.getContext("2d")!.drawImage(off, 0, 0);
      }
      const mk = maskRef.current;
      if (mk) { mk.width = W; mk.height = H; }
      setImgReady(true);
    };
  }, [frame.image]);

  // Recompute mask whenever preset / image / compare mode changes
  useEffect(() => {
    if (!imgReady) return;
    const off = sampleCanvasRef.current;
    const mk = maskRef.current;
    if (!off || !mk) return;
    const ctx = off.getContext("2d")!;
    const mctx = mk.getContext("2d")!;
    const { width: W, height: H } = off;
    const src = ctx.getImageData(0, 0, W, H);
    const out = mctx.createImageData(W, H);

    let detected = 0;
    let overlapPixels = 0;
    const total = W * H;

    if (!compareAll) {
      const [hL, hU] = preset.h, [sL, sU] = preset.s, [vL, vU] = preset.v;
      const others = teamList
        .filter((t) => t.id !== teamId)
        .map((t) => ({ p: presets[presetKey(t.id, frame.id)] ?? presetFromColor(t.color), c: teamSwatch(t.id) }));
      for (let i = 0; i < src.data.length; i += 4) {
        const [h, s, v] = rgbToHsvCv(src.data[i], src.data[i + 1], src.data[i + 2]);
        const ok = h >= hL && h <= hU && s >= sL && s <= sU && v >= vL && v <= vU;
        let conflict = false;
        if (ok) {
          detected++;
          for (const o of others) {
            if (h >= o.p.h[0] && h <= o.p.h[1] && s >= o.p.s[0] && s <= o.p.s[1] && v >= o.p.v[0] && v <= o.p.v[1]) {
              conflict = true; break;
            }
          }
          if (conflict) overlapPixels++;
        }
        if (ok && conflict) {
          out.data[i] = 240; out.data[i + 1] = 80; out.data[i + 2] = 80;
        } else if (ok) {
          out.data[i] = 255; out.data[i + 1] = 255; out.data[i + 2] = 255;
        } else {
          out.data[i] = 12; out.data[i + 1] = 12; out.data[i + 2] = 12;
        }
        out.data[i + 3] = 255;
      }
    } else {
      // colorize each pixel by first matching team
      const all = teamList.map((t) => ({
        id: t.id,
        p: presets[presetKey(t.id, frame.id)] ?? presetFromColor(t.color),
        c: teamSwatch(t.id),
      }));
      const myIdx = all.findIndex((a) => a.id === teamId);
      for (let i = 0; i < src.data.length; i += 4) {
        const [h, s, v] = rgbToHsvCv(src.data[i], src.data[i + 1], src.data[i + 2]);
        let matched = -1;
        for (let k = 0; k < all.length; k++) {
          const a = all[k];
          if (h >= a.p.h[0] && h <= a.p.h[1] && s >= a.p.s[0] && s <= a.p.s[1] && v >= a.p.v[0] && v <= a.p.v[1]) {
            matched = k; break;
          }
        }
        if (matched < 0) {
          out.data[i] = 12; out.data[i + 1] = 12; out.data[i + 2] = 12;
        } else {
          const [cr, cg, cb] = hexToRgb(all[matched].c);
          out.data[i] = cr; out.data[i + 1] = cg; out.data[i + 2] = cb;
          if (matched === myIdx) detected++;
        }
        out.data[i + 3] = 255;
      }
    }
    mctx.putImageData(out, 0, 0);
    setMaskStats({ detected, total, overlapPct: detected > 0 ? Math.round((overlapPixels / detected) * 100) : 0 });
  }, [preset, presets, imgReady, compareAll, teamId, teamList, frame.id, savedColors]);

  const onPreviewClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const off = sampleCanvasRef.current;
    const pv = previewRef.current;
    if (!off || !pv) return;
    const rect = pv.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * off.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * off.height);
    const d = off.getContext("2d")!.getImageData(x, y, 1, 1).data;
    const r = d[0], g = d[1], b = d[2];
    const [h, s, v] = rgbToHsvCv(r, g, b);
    const pick: PickedColor = { r, g, b, h, s, v };
    setLastPick(pick);
    setHistory((prev) => [pick, ...prev.filter((p) => !(p.r === r && p.g === g && p.b === b))].slice(0, 5));
    setPreset(rangesAround(h, s, v));
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const id = `upload-${Date.now()}`;
    setFrames((prev) => [...prev, { id, name: `Upload · ${file.name.slice(0, 14)}`, image: url }]);
    setPresets((prev) => {
      const next = { ...prev };
      for (const t of teams) next[presetKey(t.id, id)] = presetFromColor(t.color);
      return next;
    });
    setSavedColors((prev) => {
      const next = { ...prev };
      for (const t of teams) next[presetKey(t.id, id)] = t.color;
      return next;
    });
    setFrameId(id);
    e.target.value = "";
  };

  // Mask quality heuristic
  const detectedPct = (maskStats.detected / maskStats.total) * 100;
  let status: { label: string; tone: "good" | "warn" | "bad" } = { label: "good", tone: "good" };
  let noise: "low" | "medium" | "high" = "low";
  if (detectedPct < 0.1) { status = { label: "too narrow", tone: "warn" }; noise = "low"; }
  else if (detectedPct > 12) { status = { label: "too wide", tone: "bad" }; noise = "high"; }
  else if (detectedPct > 6) { status = { label: "noisy", tone: "warn" }; noise = "medium"; }
  if (maskStats.overlapPct > 25) status = { label: "conflicts", tone: "bad" };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-border bg-surface px-6">
        <h1 className="text-sm font-bold uppercase tracking-wider">HSV — Team Color Calibration</h1>
        <div className="flex items-center gap-1">
          <span className="label-eyebrow mr-2 text-xs">Sample</span>
          {frames.map((s) => (
            <button key={s.id} onClick={() => setFrameId(s.id)}
              className={`rounded-sm border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
                s.id === frameId ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface-2 text-muted-foreground hover:bg-muted"}`}>
              {s.name}
            </button>
          ))}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="ml-1 rounded-sm border border-dashed border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted">
            + Upload sample
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onUpload} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Team list */}
        <aside className="w-[260px] shrink-0 overflow-y-auto border-r border-border bg-surface p-2">
          {teamList.map((t, i) => {
            const active = t.id === teamId;
            return (
              <button key={t.id} onClick={() => setTeamId(t.id)}
                className={`mb-1 flex w-full items-center gap-2 rounded-sm border px-2 text-left transition-colors ${
                  active
                    ? "border-primary/50 bg-primary/10 py-2.5"
                    : "border-transparent py-1.5 hover:bg-muted"
                }`}>
                <span className={`shrink-0 rounded-sm ring-1 ring-border ${active ? "h-6 w-6" : "h-3 w-3"}`} style={{ backgroundColor: teamSwatch(t.id) }} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className={`font-semibold ${active ? "text-sm" : "text-xs"}`}>{t.displayName}</span>
                  {active && <span className="text-mono text-[10px] uppercase text-muted-foreground">{teamSwatch(t.id)}</span>}
                </div>
                <span className="text-mono ml-auto text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              </button>
            );
          })}
        </aside>

        {/* Editor */}
        <div className="flex min-w-0 flex-1 flex-col overflow-auto p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-7 w-7 rounded-sm ring-1 ring-border" style={{ backgroundColor: teamSwatch(team.id) }} />
            <h2 className="text-lg font-bold">{team.displayName}</h2>
            <span className="text-mono text-xs text-muted-foreground">preset</span>

            <div className="ml-auto inline-flex rounded-sm border border-border bg-surface-2 p-0.5">
              <button onClick={() => setCompareAll(false)}
                className={`rounded-sm px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${
                  !compareAll ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                Show only {team.displayName}
              </button>
              <button onClick={() => setCompareAll(true)}
                className={`rounded-sm px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${
                  compareAll ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                Show all teams mask
              </button>
            </div>
          </div>

          {/* Two previews */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="hud-panel p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="label-eyebrow text-xs">Sample frame — click to pick color</span>
                <span className="text-mono text-xs text-muted-foreground">{frame.name}</span>
              </div>
              <div className="relative w-full overflow-hidden rounded-sm border border-border bg-background">
                <canvas ref={previewRef} onClick={onPreviewClick} className="block w-full cursor-crosshair" />
              </div>

              {/* Picked color + history */}
              <div className="mt-3 flex items-stretch gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3 rounded-sm border border-border bg-surface-2 p-2.5">
                  <div className="h-12 w-12 shrink-0 rounded-sm ring-1 ring-border"
                       style={{ backgroundColor: lastPick ? `rgb(${lastPick.r},${lastPick.g},${lastPick.b})` : "transparent" }} />
                  <div className="min-w-0 flex-1">
                    <div className="label-eyebrow mb-1 text-[10px]">Picked pixel</div>
                    {lastPick ? (
                      <div className="text-mono text-xs leading-snug tabular-nums">
                        <div>H: {lastPick.h} / S: {lastPick.s} / V: {lastPick.v}</div>
                        <div className="text-muted-foreground">RGB: {lastPick.r}, {lastPick.g}, {lastPick.b}</div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">Click anywhere on the frame…</div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col rounded-sm border border-border bg-surface-2 p-2.5">
                  <div className="label-eyebrow mb-1.5 text-[10px]">Last 5</div>
                  <div className="flex gap-1.5">
                    {Array.from({ length: 5 }).map((_, i) => {
                      const p = history[i];
                      return (
                        <button key={i}
                          onClick={() => p && (setLastPick(p), setPreset(rangesAround(p.h, p.s, p.v)))}
                          title={p ? `H${p.h} S${p.s} V${p.v}` : "—"}
                          className="h-7 w-7 rounded-sm border border-border"
                          style={{ backgroundColor: p ? `rgb(${p.r},${p.g},${p.b})` : "transparent" }} />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="hud-panel p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="label-eyebrow text-xs">{compareAll ? "All teams mask" : "Binary HSV mask"}</span>
                <span className="text-mono text-xs text-muted-foreground">live</span>
              </div>
              <div className="relative w-full overflow-hidden rounded-sm border border-border bg-background">
                <canvas ref={maskRef} className="block w-full" />
              </div>

              {/* Quality score */}
              <div className="mt-3 grid grid-cols-4 gap-2">
                <Stat label="Detected" value={`${maskStats.detected.toLocaleString()} px`} sub={`${detectedPct.toFixed(2)}%`} />
                <Stat label="Noise" value={noise} />
                <Stat label="Overlap" value={`${maskStats.overlapPct}%`} sub={!compareAll ? "(red pixels)" : ""} />
                <Stat label="Status" value={status.label} tone={status.tone} />
              </div>
            </div>
          </div>

          {/* Conflict warning */}
          {conflicts.length > 0 && (
            <div className="hud-panel mt-4 border-l-4 border-l-warning p-3">
              <div className="label-eyebrow mb-2 text-xs text-warning">Conflict warning</div>
              <div className="flex flex-wrap gap-2">
                {conflicts.slice(0, 6).map((c) => (
                  <div key={c.team.id} className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-2 px-2 py-1 text-xs">
                    <span className="h-3 w-3 rounded-sm ring-1 ring-border" style={{ backgroundColor: teamSwatch(c.team.id) }} />
                    <span className="font-semibold">{c.team.displayName}</span>
                    <span className={`text-mono tabular-nums ${c.pct >= 30 ? "text-destructive" : "text-warning"}`}>{c.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="hud-panel mt-4 p-4">
            <div className="label-eyebrow mb-3">HSV range</div>
            <Range label="Hue" min={0} max={179} value={preset.h} onChange={(h) => setPreset({ h: h as Range3 })} />
            <Range label="Saturation" min={0} max={255} value={preset.s} onChange={(s) => setPreset({ s: s as Range3 })} />
            <Range label="Value" min={0} max={255} value={preset.v} onChange={(v) => setPreset({ v: v as Range3 })} />

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => setPresets((p) => ({ ...p, [k]: presetFromColor(team.color) }))}
                className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-xs font-semibold hover:bg-muted">
                Reset to team color
              </button>
              <button className="rounded-sm border border-primary/50 bg-surface-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-primary hover:bg-primary/10">
                Save as new profile
              </button>
              <button
                onClick={() => setSavedColors((s) => ({ ...s, [k]: presetCenterHex(preset) }))}
                className="rounded-sm bg-primary px-5 py-2 text-sm font-bold uppercase tracking-wider text-primary-foreground shadow-md hover:brightness-110">
                Save preset
              </button>
            </div>
          </div>

          {/* Developer block */}
          <div className="hud-panel mt-4">
            <button
              onClick={() => setShowDevSnippet((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left">
              <span className="label-eyebrow text-xs">For developer — OpenCV snippet</span>
              <span className="text-mono text-xs text-muted-foreground">{showDevSnippet ? "▾ hide" : "▸ show"}</span>
            </button>
            {showDevSnippet && (
              <div className="border-t border-border p-4">
                <pre className="text-mono overflow-x-auto rounded-sm border border-border bg-background p-3 text-xs leading-relaxed text-foreground">
{`# ${team.displayName}
lower = np.array([${preset.h[0]}, ${preset.s[0]}, ${preset.v[0]}])
upper = np.array([${preset.h[1]}, ${preset.s[1]}, ${preset.v[1]}])
mask  = cv2.inRange(hsv, lower, upper)`}
                </pre>
                <p className="mt-3 text-xs text-muted-foreground">
                  Tip: click anywhere on the sample frame to pick a pixel — HSV ranges are seeded around that color. Each team keeps its own preset.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  const toneCls = tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-sm border border-border bg-surface-2 p-2">
      <div className="label-eyebrow text-[10px]">{label}</div>
      <div className={`text-mono text-sm font-bold tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="text-mono text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Range({ label, min, max, value, onChange }: {
  label: string; min: number; max: number; value: [number, number]; onChange: (v: [number, number]) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="label-eyebrow text-xs">{label}</span>
        <span className="text-mono text-xs tabular-nums text-muted-foreground">{value[0]} — {value[1]}</span>
      </div>
      <div className="flex items-center gap-2">
        <input type="range" min={min} max={max} value={value[0]}
          onChange={(e) => onChange([Math.min(+e.target.value, value[1]), value[1]])}
          className="w-full accent-[var(--color-primary)]" />
        <input type="range" min={min} max={max} value={value[1]}
          onChange={(e) => onChange([value[0], Math.max(+e.target.value, value[0])])}
          className="w-full accent-[var(--color-primary)]" />
      </div>
    </div>
  );
}
