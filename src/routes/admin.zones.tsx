import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/admin/zones")({ component: ZonesAdmin });

type Zone = { id: string; name: string; x: number; y: number; w: number; h: number };

const initialZones: Zone[] = [
  { id: "z-minimap", name: "Minimap",       x: 40,   y: 40,  w: 280, h: 280 },
  { id: "z-team",    name: "Team panel",    x: 1500, y: 60,  w: 380, h: 480 },
  { id: "z-killf",   name: "Kill feed",     x: 1500, y: 580, w: 380, h: 280 },
  { id: "z-timer",   name: "Round timer",   x: 880,  y: 30,  w: 160, h: 60 },
];

function ZonesAdmin() {
  const [zones, setZones] = useState<Zone[]>(initialZones);
  const [sel, setSel] = useState<string | null>(zones[0]?.id ?? null);
  const W = 1920, H = 1080;
  const selZone = zones.find((z) => z.id === sel);

  const update = (id: string, patch: Partial<Zone>) =>
    setZones((zs) => zs.map((z) => (z.id === id ? { ...z, ...patch } : z)));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-wider">Zones</h1>
          <div className="label-eyebrow text-[9px]">HUD areas · 1920 × 1080</div>
        </div>
        <div className="flex gap-2">
          <button className="rounded-sm border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold hover:bg-muted">Import frame</button>
          <button className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">Save</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto bg-background p-6">
          <div className="hud-panel-strong relative" style={{ width: "min(100%, 1280px)", aspectRatio: `${W}/${H}` }}>
            <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full hud-grid-bg">
              {zones.map((z) => {
                const active = z.id === sel;
                return (
                  <g key={z.id} style={{ cursor: "pointer" }} onClick={() => setSel(z.id)}>
                    <rect x={z.x} y={z.y} width={z.w} height={z.h}
                      fill={active ? "rgba(255,91,18,0.18)" : "rgba(34,196,245,0.10)"}
                      stroke={active ? "#ff5b12" : "rgba(34,196,245,0.65)"} strokeWidth={3} />
                    <text x={z.x + 10} y={z.y + 28} fontSize={20} fontWeight={700}
                      fill="#fff" fontFamily="Manrope, sans-serif"
                      stroke="rgba(0,0,0,0.7)" strokeWidth={4} paintOrder="stroke">{z.name}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <aside className="w-[300px] shrink-0 border-l border-border bg-surface p-3 overflow-y-auto">
          <div className="label-eyebrow mb-2">Zones ({zones.length})</div>
          {zones.map((z) => (
            <button key={z.id} onClick={() => setSel(z.id)}
              className={`mb-1 flex w-full items-center justify-between rounded-sm border px-2 py-1.5 text-left transition-colors ${
                z.id === sel ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-muted"}`}>
              <span className="text-xs font-semibold">{z.name}</span>
              <span className="text-mono text-[10px] text-muted-foreground">{z.w}×{z.h}</span>
            </button>
          ))}

          {selZone && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="label-eyebrow mb-2">Edit</div>
              <Field label="Name" value={selZone.name} onChange={(v) => update(selZone.id, { name: v })} />
              <div className="grid grid-cols-2 gap-2">
                <NumField label="X" value={selZone.x} onChange={(v) => update(selZone.id, { x: v })} />
                <NumField label="Y" value={selZone.y} onChange={(v) => update(selZone.id, { y: v })} />
                <NumField label="W" value={selZone.w} onChange={(v) => update(selZone.id, { w: v })} />
                <NumField label="H" value={selZone.h} onChange={(v) => update(selZone.id, { h: v })} />
              </div>
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
