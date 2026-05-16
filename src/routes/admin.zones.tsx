import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import vodBg from "@/assets/hsv-samples/worlds-edge.png";
import cameraBg from "@/assets/zones-samples/camera.png";

export const Route = createFileRoute("/admin/zones")({ component: ZonesAdmin });

type ZoneTag = "team" | "camera" | "minimap" | "timer" | "map_name";
type Zone = { id: string; name: string; tag: ZoneTag; x: number; y: number; w: number; h: number };
type Mode = "vod" | "camera";

const TAGS: ZoneTag[] = ["team", "camera", "minimap", "timer", "map_name"];

const TAG_COLOR: Record<ZoneTag, string> = {
  team:     "#22c4f5",
  camera:   "#a78bfa",
  minimap:  "#ff5b12",
  timer:    "#facc15",
  map_name: "#34d399",
};

const initialVod: Zone[] = [
  { id: "v-minimap",  name: "Minimap",    tag: "minimap",  x: 20,   y: 30,   w: 320, h: 320 },
  { id: "v-map-name", name: "Map name",   tag: "map_name", x: 360,  y: 170,  w: 380, h: 80  },
  { id: "v-timer",    name: "Round timer",tag: "timer",    x: 20,   y: 380,  w: 320, h: 90  },
  { id: "v-team-l",   name: "Team panel", tag: "team",     x: 20,   y: 720,  w: 540, h: 280 },
  { id: "v-team-h1",  name: "Team header",tag: "team",     x: 0,    y: 0,    w: 480, h: 36  },
  { id: "v-team-h2",  name: "Team header",tag: "team",     x: 510,  y: 0,    w: 480, h: 36  },
  { id: "v-team-h3",  name: "Team header",tag: "team",     x: 1010, y: 0,    w: 480, h: 36  },
];

const initialCamera: Zone[] = [
  { id: "c-name",  name: "Player name",  tag: "camera",  x: 60,   y: 730, w: 480, h: 90 },
  { id: "c-squad", name: "Squad badge",  tag: "team",    x: 60,   y: 830, w: 480, h: 120 },
  { id: "c-time",  name: "Round timer",  tag: "timer",   x: 60,   y: 280, w: 320, h: 80  },
  { id: "c-mini",  name: "Minimap",      tag: "minimap", x: 20,   y: 20,  w: 360, h: 260 },
];

let _idc = 0;
const newId = () => `z-${Date.now().toString(36)}-${_idc++}`;

function ZonesAdmin() {
  const [mode, setMode] = useState<Mode>("vod");
  const [vodZones, setVodZones] = useState<Zone[]>(initialVod);
  const [camZones, setCamZones] = useState<Zone[]>(initialCamera);
  const [sel, setSel] = useState<string | null>(initialVod[0]?.id ?? null);

  const W = 1920, H = 1080;
  const zones = mode === "vod" ? vodZones : camZones;
  const setZones = mode === "vod" ? setVodZones : setCamZones;
  const bg = mode === "vod" ? vodBg : cameraBg;
  const selZone = zones.find((z) => z.id === sel);

  const switchMode = (m: Mode) => {
    setMode(m);
    const list = m === "vod" ? vodZones : camZones;
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
          <button onClick={addZone} className="rounded-sm border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold hover:bg-muted">+ Add zone</button>
          <button className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">Save</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto bg-background p-6">
          <div className="hud-panel-strong relative overflow-hidden" style={{ width: "min(100%, 1280px)", aspectRatio: `${W}/${H}` }}>
            <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" draggable={false} />
            <div className="absolute inset-0 bg-background/10" />
            <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full">
              {zones.map((z) => {
                const active = z.id === sel;
                const c = TAG_COLOR[z.tag];
                return (
                  <g key={z.id} style={{ cursor: "pointer" }} onClick={() => setSel(z.id)}>
                    <rect x={z.x} y={z.y} width={z.w} height={z.h}
                      fill={active ? `${c}33` : `${c}1a`}
                      stroke={c} strokeWidth={active ? 4 : 2.5} />
                    <rect x={z.x} y={z.y - 32} width={Math.max(160, z.name.length * 11 + 90)} height={28} fill={c} />
                    <text x={z.x + 8} y={z.y - 11} fontSize={16} fontWeight={800} fill="#0a0a0a" fontFamily="Manrope, sans-serif">
                      {z.name} · {z.tag}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <aside className="w-[320px] shrink-0 border-l border-border bg-surface p-3 overflow-y-auto">
          <div className="label-eyebrow mb-2">Zones ({zones.length})</div>
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
