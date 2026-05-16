import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import vodBg from "@/assets/hsv-samples/worlds-edge.png";
import cameraBg from "@/assets/zones-samples/camera.png";
import { useAdminStore, setZones as setZonesStore, type Zone, type ZoneTag, type ZoneMode } from "@/lib/admin-store";

export const Route = createFileRoute("/admin/zones")({ component: ZonesAdmin });

type Mode = ZoneMode;

const TAGS: ZoneTag[] = ["team", "camera", "minimap", "timer", "map_name"];

const TAG_COLOR: Record<ZoneTag, string> = {
  team:     "#22c4f5",
  camera:   "#a78bfa",
  minimap:  "#ff5b12",
  timer:    "#facc15",
  map_name: "#34d399",
};

let _idc = 0;
const newId = () => `z-${Date.now().toString(36)}-${_idc++}`;

function ZonesAdmin() {
  const store = useAdminStore();
  const [mode, setMode] = useState<Mode>("vod");
  const [sel, setSel] = useState<string | null>(store.zones.vod[0]?.id ?? null);
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
  const setZones = (next: Zone[] | ((zs: Zone[]) => Zone[])) => {
    const computed = typeof next === "function" ? (next as (zs: Zone[]) => Zone[])(zones) : next;
    setZonesStore(mode, computed);
  };
  const bg = mode === "vod" ? vodBg : cameraBg;
  const selZone = zones.find((z) => z.id === sel);

  const switchMode = (m: Mode) => {
    setMode(m);
    const list = store.zones[m];
    setSel(list[0]?.id ?? null);
  };

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
    update(d.id, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-wider">Zones</h1>
          <div className="label-eyebrow text-[9px]">HUD areas · 1920 × 1080</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-sm border border-border bg-surface-2 p-0.5">
            {(["vod", "camera"] as Mode[]).map((m) => (
              <button key={m} onClick={() => switchMode(m)}
                className={`rounded-sm px-3 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                  mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>
                {m === "vod" ? "VOD stream" : "Player cam"}
              </button>
            ))}
          </div>
          <button className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">Save</button>
        </div>
      </header>

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
              {zones.map((z) => {
                const active = z.id === sel;
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
                return (
                  <g key={z.id}>
                    <rect
                      x={z.x} y={z.y} width={z.w} height={z.h}
                      fill={active ? `${c}33` : `${c}1a`}
                      stroke={c} strokeWidth={active ? 4 : 2.5}
                      style={{ cursor: "move" }}
                      onPointerDown={(e) => onPointerDown(e, z, "move")}
                    />
                    <rect x={z.x} y={z.y - 32} width={Math.max(160, z.name.length * 11 + 90)} height={28} fill={c}
                      style={{ cursor: "move" }}
                      onPointerDown={(e) => onPointerDown(e, z, "move")} />
                    <text x={z.x + 8} y={z.y - 11} fontSize={16} fontWeight={800} fill="#0a0a0a" fontFamily="Manrope, sans-serif" pointerEvents="none">
                      {z.name} · {z.tag}
                    </text>
                    {active && handles.map((h) => (
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
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <aside className="w-[320px] shrink-0 border-l border-border bg-surface p-3 overflow-y-auto">
          <div className="mb-2 flex items-center justify-between">
            <div className="label-eyebrow">Zones ({zones.length})</div>
            <button onClick={addZone}
              className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-[11px] font-semibold hover:bg-muted">
              + Add
            </button>
          </div>
          {zones.map((z) => (
            <div key={z.id}
              className={`mb-1 flex items-center gap-1 rounded-sm border px-2 py-1.5 transition-colors ${
                z.id === sel ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-muted"}`}>
              <button onClick={() => setSel(z.id)} className="flex flex-1 items-center gap-2 text-left">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: TAG_COLOR[z.tag] }} />
                <span className="truncate text-xs font-semibold">{z.name}</span>
                <span className="text-mono text-[9px] uppercase text-muted-foreground">{z.tag}</span>
              </button>
              <button onClick={() => removeZone(z.id)} title="Delete"
                className="rounded-sm px-1.5 text-[11px] text-muted-foreground hover:bg-destructive/20 hover:text-destructive">×</button>
            </div>
          ))}

          {selZone && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="label-eyebrow mb-2">Edit</div>
              <Field label="Name" value={selZone.name} onChange={(v) => update(selZone.id, { name: v })} />
              <label className="mb-2 block">
                <span className="label-eyebrow mb-1 block text-[10px]">Tag</span>
                <select value={selZone.tag} onChange={(e) => update(selZone.id, { tag: e.target.value as ZoneTag })}
                  className="w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary/60">
                  {TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <NumField label="X" value={selZone.x} onChange={(v) => update(selZone.id, { x: v })} />
                <NumField label="Y" value={selZone.y} onChange={(v) => update(selZone.id, { y: v })} />
                <NumField label="W" value={selZone.w} onChange={(v) => update(selZone.id, { w: v })} />
                <NumField label="H" value={selZone.h} onChange={(v) => update(selZone.id, { h: v })} />
              </div>
              <button onClick={() => removeZone(selZone.id)}
                className="mt-3 w-full rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/20">
                Delete zone
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="mb-2 block">
      <span className="label-eyebrow mb-1 block text-[10px]">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary/60" />
    </label>
  );
}
function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="label-eyebrow mb-1 block text-[10px]">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(+e.target.value || 0)}
        className="text-mono w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs tabular-nums outline-none focus:border-primary/60" />
    </label>
  );
}
