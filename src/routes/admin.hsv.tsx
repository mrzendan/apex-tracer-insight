import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { teams } from "@/lib/mock-match";

export const Route = createFileRoute("/admin/hsv")({ component: HsvAdmin });

function HsvAdmin() {
  const [teamId, setTeamId] = useState(teams[0].id);
  const team = teams.find((t) => t.id === teamId)!;
  const [h, setH] = useState([0, 30]);
  const [s, setS] = useState([80, 255]);
  const [v, setV] = useState([80, 255]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-surface px-6">
        <h1 className="text-sm font-bold uppercase tracking-wider">HSV — Team Color Calibration</h1>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Team list */}
        <aside className="w-[220px] shrink-0 overflow-y-auto border-r border-border bg-surface p-2">
          {teams.map((t) => (
            <button key={t.id} onClick={() => setTeamId(t.id)}
              className={`mb-1 flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-left transition-colors ${
                t.id === teamId ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-muted"}`}>
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: t.color }} />
              <span className="text-xs font-semibold">{t.tag}</span>
              <span className="text-mono ml-auto text-[10px] text-muted-foreground">#{t.placement}</span>
            </button>
          ))}
        </aside>

        {/* Editor */}
        <div className="flex min-w-0 flex-1 flex-col overflow-auto p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-6 w-6 rounded-sm" style={{ backgroundColor: team.color }} />
            <h2 className="text-lg font-bold">{team.name}</h2>
            <span className="text-mono text-xs text-muted-foreground">{team.tag}</span>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Preview */}
            <div className="hud-panel p-4">
              <div className="label-eyebrow mb-2">Frame preview</div>
              <div className="aspect-video w-full rounded-sm border border-border bg-background hud-grid-bg" />
              <p className="mt-2 text-xs text-muted-foreground">Drop a screenshot here to test the HSV mask.</p>
            </div>

            {/* Controls */}
            <div className="hud-panel p-4">
              <div className="label-eyebrow mb-3">HSV range</div>
              <Range label="Hue" min={0} max={179} value={h} onChange={setH} />
              <Range label="Saturation" min={0} max={255} value={s} onChange={setS} />
              <Range label="Value" min={0} max={255} value={v} onChange={setV} />

              <div className="mt-4 rounded-sm border border-border bg-background p-3">
                <div className="label-eyebrow mb-1.5 text-[10px]">OpenCV snippet</div>
                <pre className="text-mono overflow-x-auto text-[11px] leading-relaxed text-foreground">
{`lower = np.array([${h[0]}, ${s[0]}, ${v[0]}])
upper = np.array([${h[1]}, ${s[1]}, ${v[1]}])
mask  = cv2.inRange(hsv, lower, upper)`}
                </pre>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button className="rounded-sm border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold hover:bg-muted">Reset</button>
                <button className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">Save</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Range({ label, min, max, value, onChange }: {
  label: string; min: number; max: number; value: number[]; onChange: (v: number[]) => void;
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
