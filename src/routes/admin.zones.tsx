import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Lock, Unlock, Pencil, Copy, RotateCcw, AlignCenter, Files } from "lucide-react";
import vodBg from "@/assets/hsv-samples/worlds-edge.png";
import cameraBg from "@/assets/zones-samples/camera.png";
import { useAdminStore, setZones as setZonesStore, type Zone, type ZoneTag, type ZoneMode } from "@/lib/admin-store";

export const Route = createFileRoute("/admin/zones")({ component: ZonesAdmin });

type Preset = "vod" | "camera" | "observer" | "algs" | "custom";
const PRESETS: { id: Preset; label: string; mode: ZoneMode }[] = [
  { id: "vod",      label: "VOD Stream",   mode: "vod" },
  { id: "camera",   label: "Player Cam",   mode: "camera" },
  { id: "observer", label: "Observer HUD", mode: "camera" },
  { id: "algs",     label: "ALGS Layout",  mode: "vod" },
  { id: "custom",   label: "Custom",       mode: "vod" },
];

const TAGS: ZoneTag[] = ["team", "camera", "minimap", "timer", "map_name"];

// Semantic colors: minimap=orange, timer=yellow, team=cyan, map_name=green, camera=purple
const TAG_COLOR: Record<ZoneTag, string> = {
  team:     "#22c4f5",
  camera:   "#a78bfa",
  minimap:  "#ff8a00",
  timer:    "#facc15",
  map_name: "#34d399",
};

let _idc = 0;
const newId = () => `z-${Date.now().toString(36)}-${_idc++}`;

type ZoneMeta = { hidden?: boolean; locked?: boolean };

function ZonesAdmin() {
  const store = useAdminStore();
  const [preset, setPreset] = useState<Preset>("vod");
  const mode: ZoneMode = PRESETS.find((p) => p.id === preset)!.mode;
  const [sel, setSel] = useState<string | null>(store.zones.vod[0]?.id ?? null);
  const [meta, setMeta] = useState<Record<string, ZoneMeta>>({});
  const [snap, setSnap] = useState(true);
  const [gridSize, setGridSize] = useState<10 | 20>(20);
  const [showGrid, setShowGrid] = useState(true);
  const [showSafe, setShowSafe] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<
    | null
    | {
        id: string;
        mode: "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
        startX: number;
        startY: number;
        orig: Zone;
      }
  >(null);

  const W = 1920, H = 1080;
  const zones = store.zones[mode];
  const bg = mode === "vod" ? vodBg : cameraBg;
  const selZone = zones.find((z) => z.id === sel);

  const setZones = (next: Zone[] | ((zs: Zone[]) => Zone[])) => {
    const computed = typeof next === "function" ? (next as (zs: Zone[]) => Zone[])(zones) : next;
    setZonesStore(mode, computed);
  };

  const choosePreset = (p: Preset) => {
    setPreset(p);
    const m = PRESETS.find((x) => x.id === p)!.mode;
    const list = store.zones[m];
    setSel(list[0]?.id ?? null);
  };

  const getMeta = (id: string): ZoneMeta => meta[id] ?? {};
  const patchMeta = (id: string, p: ZoneMeta) =>
    setMeta((m) => ({ ...m, [id]: { ...(m[id] ?? {}), ...p } }));

  const snapVal = (v: number) => (snap ? Math.round(v / gridSize) * gridSize : Math.round(v));

  const update = (id: string, patch: Partial<Zone>) =>
    setZones((zs) => zs.map((z) => (z.id === id ? { ...z, ...patch } : z)));

  const addZone = () => {
    const z: Zone = { id: newId(), name: "New zone", tag: "team", x: 760, y: 460, w: 400, h: 160 };
    setZones((zs) => [...zs, z]);
    setSel(z.id);
  };

  const removeZone = (id: string) => {
    setZones((zs) => zs.filter((z) => z.id !== id));
    if (sel === id) setSel(null);
  };

  const duplicateZone = (z: Zone) => {
    const nz: Zone = { ...z, id: newId(), name: z.name + " copy", x: Math.min(W - z.w, z.x + 30), y: Math.min(H - z.h, z.y + 30) };
    setZones((zs) => [...zs, nz]);
    setSel(nz.id);
  };

  const centerZone = (z: Zone) => update(z.id, { x: Math.round((W - z.w) / 2), y: Math.round((H - z.h) / 2) });

  const resetZone = (z: Zone) => update(z.id, { x: 100, y: 100, w: 400, h: 200 });

  const copyCoords = (z: Zone) => {
    const txt = `x:${z.x} y:${z.y} w:${z.w} h:${z.h}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
  };

  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    };
  };

  const onPointerDown = (
    e: React.PointerEvent,
    zone: Zone,
    mode: "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw",
  ) => {
    if (getMeta(zone.id).locked) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSel(zone.id);
    const p = toSvg(e.clientX, e.clientY);
    dragRef.current = { id: zone.id, mode, startX: p.x, startY: p.y, orig: { ...zone } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toSvg(e.clientX, e.clientY);
    const dx = p.x - d.startX;
    const dy = p.y - d.startY;
    let { x, y, w, h } = d.orig;
    const min = 20;
    if (d.mode === "move") {
      x = Math.max(0, Math.min(W - w, d.orig.x + dx));
      y = Math.max(0, Math.min(H - h, d.orig.y + dy));
    } else {
      if (d.mode.includes("e")) w = Math.max(min, d.orig.w + dx);
      if (d.mode.includes("s")) h = Math.max(min, d.orig.h + dy);
      if (d.mode.includes("w")) {
        const nw = Math.max(min, d.orig.w - dx);
        x = d.orig.x + (d.orig.w - nw);
        w = nw;
      }
      if (d.mode.includes("n")) {
        const nh = Math.max(min, d.orig.h - dy);
        y = d.orig.y + (d.orig.h - nh);
        h = nh;
      }
    }
    update(d.id, { x: snapVal(x), y: snapVal(y), w: snapVal(w), h: snapVal(h) });
  };

  const onPointerUp = () => { dragRef.current = null; };

  const gridLines = useMemo(() => {
    if (!showGrid) return null;
    const step = gridSize === 10 ? 80 : 160; // displayed grid coarser; major lines
    const lines: React.ReactElement[] = [];
    for (let x = step; x < W; x += step) lines.push(<line key={`vx${x}`} x1={x} y1={0} x2={x} y2={H} stroke="#ffffff" strokeOpacity={0.08} strokeWidth={1} />);
    for (let y = step; y < H; y += step) lines.push(<line key={`hy${y}`} x1={0} y1={y} x2={W} y2={y} stroke="#ffffff" strokeOpacity={0.08} strokeWidth={1} />);
    return <g pointerEvents="none">{lines}</g>;
  }, [showGrid, gridSize]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-wider">Zones</h1>
          <div className="label-eyebrow text-xs">HUD areas · 1920 × 1080</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-sm border border-border bg-surface-2 p-0.5">
            {PRESETS.map((p) => (
              <button key={p.id} onClick={() => choosePreset(p.id)}
                className={`rounded-sm px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  preset === p.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          <button className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">Save</button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-4 border-b border-border bg-surface-2 px-6 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">Snap to grid</span>
        </label>
        <div className="flex rounded-sm border border-border bg-surface p-0.5">
          {[10, 20].map((g) => (
            <button key={g} onClick={() => setGridSize(g as 10 | 20)}
              className={`px-2 py-0.5 text-[11px] font-semibold ${gridSize === g ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {g}px
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">Show grid</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} />
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">Safe frame</span>
        </label>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto bg-background p-6">
          <div className="hud-panel-strong relative overflow-hidden" style={{ width: "min(100%, 1280px)", aspectRatio: `${W}/${H}` }}>
            <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" draggable={false} />
            <div className="absolute inset-0 bg-background/10" />
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="absolute inset-0 h-full w-full touch-none select-none"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {gridLines}
              {showSafe && (
                <rect x={W * 0.05} y={H * 0.05} width={W * 0.9} height={H * 0.9}
                  fill="none" stroke="#ff5b12" strokeOpacity={0.7} strokeDasharray="12 8" strokeWidth={2} pointerEvents="none" />
              )}
              {zones.map((z) => {
                if (getMeta(z.id).hidden) return null;
                const active = z.id === sel;
                const locked = getMeta(z.id).locked;
                const c = TAG_COLOR[z.tag];
                const handle = 22;
                const handles: { m: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"; cx: number; cy: number; cur: string }[] = [
                  { m: "nw", cx: z.x,         cy: z.y,         cur: "nwse-resize" },
                  { m: "ne", cx: z.x + z.w,   cy: z.y,         cur: "nesw-resize" },
                  { m: "sw", cx: z.x,         cy: z.y + z.h,   cur: "nesw-resize" },
                  { m: "se", cx: z.x + z.w,   cy: z.y + z.h,   cur: "nwse-resize" },
                  { m: "n",  cx: z.x + z.w/2, cy: z.y,         cur: "ns-resize" },
                  { m: "s",  cx: z.x + z.w/2, cy: z.y + z.h,   cur: "ns-resize" },
                  { m: "w",  cx: z.x,         cy: z.y + z.h/2, cur: "ew-resize" },
                  { m: "e",  cx: z.x + z.w,   cy: z.y + z.h/2, cur: "ew-resize" },
                ];
                // active = bright, others = translucent
                const fillOpacity = active ? "33" : "0d";
                const strokeOpacity = active ? 1 : 0.45;
                return (
                  <g key={z.id} opacity={active ? 1 : 0.75}>
                    <rect
                      x={z.x} y={z.y} width={z.w} height={z.h}
                      fill={`${c}${fillOpacity}`}
                      stroke={c} strokeOpacity={strokeOpacity}
                      strokeWidth={active ? 4 : 2}
                      strokeDasharray={locked ? "8 6" : undefined}
                      style={{ cursor: locked ? "not-allowed" : "move" }}
                      onPointerDown={(e) => onPointerDown(e, z, "move")}
                    />
                    {active && (
                      <>
                        <rect x={z.x} y={z.y - 32} width={Math.max(160, z.name.length * 11 + 90)} height={28} fill={c}
                          style={{ cursor: locked ? "not-allowed" : "move" }}
                          onPointerDown={(e) => onPointerDown(e, z, "move")} />
                        <text x={z.x + 8} y={z.y - 11} fontSize={16} fontWeight={800} fill="#0a0a0a" fontFamily="Manrope, sans-serif" pointerEvents="none">
                          {z.name} · {z.tag}{locked ? " · locked" : ""}
                        </text>
                        {!locked && handles.map((h) => (
                          <rect
                            key={h.m}
                            x={h.cx - handle/2}
                            y={h.cy - handle/2}
                            width={handle}
                            height={handle}
                            fill="#0a0a0a"
                            stroke={c}
                            strokeWidth={3}
                            style={{ cursor: h.cur }}
                            onPointerDown={(e) => onPointerDown(e, z, h.m)}
                          />
                        ))}
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <aside className="w-[340px] shrink-0 border-l border-border bg-surface p-3 overflow-y-auto">
          <div className="mb-2 flex items-center justify-between">
            <div className="label-eyebrow">Zones ({zones.length})</div>
            <button onClick={addZone}
              className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-xs font-semibold hover:bg-muted">
              + Add
            </button>
          </div>
          {zones.map((z) => {
            const m = getMeta(z.id);
            const c = TAG_COLOR[z.tag];
            // crop dimensions
            const cropW = 60, cropH = 34;
            const scale = Math.min(cropW / z.w, cropH / z.h);
            const dispW = z.w * scale;
            const dispH = z.h * scale;
            return (
              <div key={z.id}
                className={`mb-1 flex items-center gap-2 rounded-sm border px-2 py-1.5 transition-colors ${
                  z.id === sel ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-muted"} ${m.hidden ? "opacity-50" : ""}`}>
                <button onClick={() => setSel(z.id)} className="flex flex-1 items-center gap-2 text-left min-w-0">
                  {/* mini crop preview */}
                  <div className="relative shrink-0 overflow-hidden rounded-sm border border-border bg-background"
                    style={{ width: cropW, height: cropH }}>
                    <div
                      className="absolute"
                      style={{
                        width: W * (cropW / z.w),
                        height: H * (cropH / z.h),
                        left: -(z.x * (cropW / z.w)),
                        top: -(z.y * (cropH / z.h)),
                        backgroundImage: `url(${bg})`,
                        backgroundSize: "100% 100%",
                      }}
                    />
                    <div className="absolute inset-0 ring-1" style={{ boxShadow: `inset 0 0 0 1px ${c}` }} />
                    {/* zone outline within preview */}
                    <div className="absolute" style={{
                      left: (cropW - dispW) / 2, top: (cropH - dispH) / 2,
                      width: dispW, height: dispH,
                      border: `1.5px solid ${c}`,
                      display: "none",
                    }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: c }} />
                      <span className="truncate text-xs font-semibold">{z.name}</span>
                    </div>
                    <span className="text-mono text-[10px] uppercase text-muted-foreground">{z.tag} · {z.w}×{z.h}</span>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button onClick={() => patchMeta(z.id, { hidden: !m.hidden })}
                    title={m.hidden ? "Show" : "Hide"}
                    className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                    {m.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => patchMeta(z.id, { locked: !m.locked })}
                    title={m.locked ? "Unlock" : "Lock"}
                    className={`grid h-6 w-6 place-items-center rounded-sm hover:bg-muted ${m.locked ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                    {m.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => setSel(z.id)} title="Edit"
                    className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => removeZone(z.id)} title="Delete"
                    className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-destructive/20 hover:text-destructive">×</button>
                </div>
              </div>
            );
          })}

          {selZone && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="label-eyebrow mb-2">Edit</div>
              <Field label="Name" value={selZone.name} onChange={(v) => update(selZone.id, { name: v })} />
              <label className="mb-2 block">
                <span className="label-eyebrow mb-1 block text-xs">Tag</span>
                <select value={selZone.tag} onChange={(e) => update(selZone.id, { tag: e.target.value as ZoneTag })}
                  className="w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary/60">
                  {TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <NumField label="X" value={selZone.x} onChange={(v) => update(selZone.id, { x: snapVal(v) })} />
                <NumField label="Y" value={selZone.y} onChange={(v) => update(selZone.id, { y: snapVal(v) })} />
                <NumField label="W" value={selZone.w} onChange={(v) => update(selZone.id, { w: snapVal(v) })} />
                <NumField label="H" value={selZone.h} onChange={(v) => update(selZone.id, { h: snapVal(v) })} />
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1">
                <ActionBtn icon={<Copy className="h-3 w-3" />} label="Copy" onClick={() => copyCoords(selZone)} />
                <ActionBtn icon={<RotateCcw className="h-3 w-3" />} label="Reset" onClick={() => resetZone(selZone)} />
                <ActionBtn icon={<AlignCenter className="h-3 w-3" />} label="Center" onClick={() => centerZone(selZone)} />
                <ActionBtn icon={<Files className="h-3 w-3" />} label="Dup" onClick={() => duplicateZone(selZone)} />
              </div>
              <button onClick={() => removeZone(selZone.id)}
                className="mt-3 w-full rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/20">
                Delete zone
              </button>
            </div>
          )}
        </aside>
      </div>

      {/* Status bar */}
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-border bg-surface-2 px-6 text-[11px] text-muted-foreground">
        <div className="text-mono uppercase tracking-wider">
          {selZone ? (
            <>
              <span className="text-foreground font-semibold">Selected:</span> {selZone.name} · {selZone.w}×{selZone.h} · tag: <span style={{ color: TAG_COLOR[selZone.tag] }}>{selZone.tag}</span> · x:{selZone.x} y:{selZone.y}
            </>
          ) : (
            "No zone selected"
          )}
        </div>
        <div className="text-mono uppercase tracking-wider">
          Preset: {PRESETS.find((p) => p.id === preset)!.label} · Snap {snap ? `${gridSize}px` : "off"}
        </div>
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-0.5 rounded-sm border border-border bg-surface-2 px-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider hover:bg-muted">
      {icon}
      {label}
    </button>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="mb-2 block">
      <span className="label-eyebrow mb-1 block text-xs">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary/60" />
    </label>
  );
}
function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="label-eyebrow mb-1 block text-xs">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(+e.target.value || 0)}
        className="text-mono w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs tabular-nums outline-none focus:border-primary/60" />
    </label>
  );
}
