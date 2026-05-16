import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { teams } from "@/lib/mock-match";
import worldsEdgeSample from "@/assets/hsv-samples/worlds-edge.png";
import stormPointSample from "@/assets/hsv-samples/storm-point.png";
import eDistrictSample from "@/assets/hsv-samples/e-district.png";
import olympusSample from "@/assets/hsv-samples/olympus.png";

export const Route = createFileRoute("/admin/hsv")({ component: HsvAdmin });

type Range3 = [number, number];
type Preset = { h: Range3; s: Range3; v: Range3 };

const SAMPLES = [
  { id: "worlds-edge", name: "World's Edge", image: worldsEdgeSample },
  { id: "storm-point", name: "Storm Point",  image: stormPointSample },
  { id: "e-district", name: "E-District",    image: eDistrictSample },
  { id: "olympus",    name: "Olympus",       image: olympusSample },
] as const;

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
  h = Math.round((h * 60) / 2); // OpenCV: 0-179
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

function HsvAdmin() {
  const teamList = useMemo(
    () => teams.map((t, i) => ({ ...t, displayName: `Team ${i + 1}` })),
    [],
  );

  const [presets, setPresets] = useState<Record<string, Preset>>(() => {
    const init: Record<string, Preset> = {};
    for (const t of teams) init[t.id] = presetFromColor(t.color);
    return init;
  });

  const [teamId, setTeamId] = useState(teamList[0].id);
  const [sampleId, setSampleId] = useState<typeof SAMPLES[number]["id"]>("worlds-edge");

  const team = teamList.find((t) => t.id === teamId)!;
  const sample = SAMPLES.find((s) => s.id === sampleId)!;
  const preset = presets[teamId];

  const setPreset = (p: Partial<Preset>) =>
    setPresets((prev) => ({ ...prev, [teamId]: { ...prev[teamId], ...p } }));

  // Sample canvas (full resolution offscreen) for eyedropper sampling
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const [imgReady, setImgReady] = useState(false);

  // Load image into offscreen canvas
  useEffect(() => {
    setImgReady(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = sample.image;
    img.onload = () => {
      const W = 640;
      const H = Math.round((img.height / img.width) * W);
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      const ctx = off.getContext("2d")!;
      ctx.drawImage(img, 0, 0, W, H);
      sampleCanvasRef.current = off;

      // draw to visible preview
      const pv = previewRef.current;
      if (pv) {
        pv.width = W; pv.height = H;
        pv.getContext("2d")!.drawImage(off, 0, 0);
      }
      const mk = maskRef.current;
      if (mk) { mk.width = W; mk.height = H; }
      setImgReady(true);
    };
  }, [sample.image]);

  // Recompute mask whenever preset or image changes
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
    const [hL, hU] = preset.h, [sL, sU] = preset.s, [vL, vU] = preset.v;
    for (let i = 0; i < src.data.length; i += 4) {
      const [h, s, v] = rgbToHsvCv(src.data[i], src.data[i + 1], src.data[i + 2]);
      const ok = h >= hL && h <= hU && s >= sL && s <= sU && v >= vL && v <= vU;
      const c = ok ? 255 : 12;
      out.data[i] = c; out.data[i + 1] = c; out.data[i + 2] = c; out.data[i + 3] = 255;
    }
    mctx.putImageData(out, 0, 0);
  }, [preset, imgReady]);

  // Eyedropper
  const onPreviewClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const off = sampleCanvasRef.current;
    const pv = previewRef.current;
    if (!off || !pv) return;
    const rect = pv.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * off.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * off.height);
    const d = off.getContext("2d")!.getImageData(x, y, 1, 1).data;
    const [h, s, v] = rgbToHsvCv(d[0], d[1], d[2]);
    setPreset(rangesAround(h, s, v));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <h1 className="text-sm font-bold uppercase tracking-wider">HSV — Team Color Calibration</h1>
        <div className="flex items-center gap-1">
          <span className="label-eyebrow mr-2 text-[10px]">Sample</span>
          {SAMPLES.map((s) => (
            <button key={s.id} onClick={() => setSampleId(s.id)}
              className={`rounded-sm border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                s.id === sampleId ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface-2 text-muted-foreground hover:bg-muted"}`}>
              {s.name}
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Team list */}
        <aside className="w-[220px] shrink-0 overflow-y-auto border-r border-border bg-surface p-2">
          {teamList.map((t, i) => (
            <button key={t.id} onClick={() => setTeamId(t.id)}
              className={`mb-1 flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-left transition-colors ${
                t.id === teamId ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-muted"}`}>
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: t.color }} />
              <span className="text-xs font-semibold">{t.displayName}</span>
              <span className="text-mono ml-auto text-[10px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            </button>
          ))}
        </aside>

        {/* Editor */}
        <div className="flex min-w-0 flex-1 flex-col overflow-auto p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-6 w-6 rounded-sm" style={{ backgroundColor: team.color }} />
            <h2 className="text-lg font-bold">{team.displayName}</h2>
            <span className="text-mono text-xs text-muted-foreground">preset</span>
          </div>

          {/* Two previews */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="hud-panel p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="label-eyebrow text-[10px]">Sample frame — click to pick color</span>
                <span className="text-mono text-[10px] text-muted-foreground">{sample.name}</span>
              </div>
              <div className="relative w-full overflow-hidden rounded-sm border border-border bg-background">
                <canvas
                  ref={previewRef}
                  onClick={onPreviewClick}
                  className="block w-full cursor-crosshair"
                />
              </div>
            </div>

            <div className="hud-panel p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="label-eyebrow text-[10px]">Binary HSV mask</span>
                <span className="text-mono text-[10px] text-muted-foreground">live</span>
              </div>
              <div className="relative w-full overflow-hidden rounded-sm border border-border bg-background">
                <canvas ref={maskRef} className="block w-full" />
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="hud-panel p-4">
              <div className="label-eyebrow mb-3">HSV range</div>
              <Range label="Hue" min={0} max={179} value={preset.h}
                onChange={(h) => setPreset({ h: h as Range3 })} />
              <Range label="Saturation" min={0} max={255} value={preset.s}
                onChange={(s) => setPreset({ s: s as Range3 })} />
              <Range label="Value" min={0} max={255} value={preset.v}
                onChange={(v) => setPreset({ v: v as Range3 })} />

              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setPresets((p) => ({ ...p, [teamId]: presetFromColor(team.color) }))}
                  className="rounded-sm border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold hover:bg-muted">
                  Reset to team color
                </button>
                <button className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">
                  Save preset
                </button>
              </div>
            </div>

            <div className="hud-panel p-4">
              <div className="label-eyebrow mb-2">OpenCV snippet</div>
              <pre className="text-mono overflow-x-auto rounded-sm border border-border bg-background p-3 text-[11px] leading-relaxed text-foreground">
{`# ${team.displayName}
lower = np.array([${preset.h[0]}, ${preset.s[0]}, ${preset.v[0]}])
upper = np.array([${preset.h[1]}, ${preset.s[1]}, ${preset.v[1]}])
mask  = cv2.inRange(hsv, lower, upper)`}
              </pre>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Tip: click anywhere on the sample frame to pick a pixel — HSV ranges are seeded around that color. Each team keeps its own preset.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Range({ label, min, max, value, onChange }: {
  label: string; min: number; max: number; value: [number, number]; onChange: (v: [number, number]) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="label-eyebrow text-[10px]">{label}</span>
        <span className="text-mono text-[10px] tabular-nums text-muted-foreground">{value[0]} — {value[1]}</span>
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
