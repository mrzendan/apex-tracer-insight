import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { maps as seed, type ApexMap, type MapConfigKey } from "@/lib/mock-match";
import { useAdminStore } from "@/lib/admin-store";

export const Route = createFileRoute("/admin/maps")({ component: MapsAdmin });

type ViewMode = "grid" | "table";
const CONFIG_KEYS: MapConfigKey[] = ["image", "polygons", "hsv"];
const ALL_CONFIG_KEYS: MapConfigKey[] = ["image", "polygons", "hsv"];
const CONFIG_LABEL: Record<MapConfigKey, string> = {
  image: "Image",
  zones: "Zones",
  polygons: "Polygons",
  hsv: "HSV",
  camera: "Camera",
  minimap: "Minimap",
};

function defaultCode(name: string) {
  return name
    .split(/[\s'-]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3);
}

function ConfigChip({ k, ok }: { k: MapConfigKey; ok: boolean }) {
  return (
    <span
      title={`${CONFIG_LABEL[k]}: ${ok ? "configured" : "missing"}`}
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${
        ok
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : "border-border bg-surface-2 text-muted-foreground"
      }`}
    >
      <span>{CONFIG_LABEL[k]}</span>
    </span>
  );
}

function MapsAdmin() {
  const { matches } = useAdminStore();
  const [rows, setRows] = useState<ApexMap[]>(seed);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [editing, setEditing] = useState<ApexMap | null>(null);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/admin/maps" && pathname !== "/admin/maps/") {
    return <Outlet />;
  }
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => [r.name, r.code ?? ""].some((v) => v.toLowerCase().includes(q)))
    : rows;

  const playedInById = useMemo(() => {
    const map: Record<string, number> = {};
    rows.forEach((mp) => {
      map[mp.id] = matches.filter((m) => (m.mapIds ?? [m.mapId]).includes(mp.id)).length;
    });
    return map;
  }, [matches, rows]);

  const open = (id: string) =>
    navigate({ to: "/admin/maps/$mapId" as "/admin/maps", params: { mapId: id } as never });

  const startCreate = () =>
    setEditing({
      id: `map-${Date.now()}`,
      name: "",
      image: "",
      code: "",
      previewImage: "",
      config: { image: false, zones: false, polygons: false, hsv: false, camera: false, minimap: false },
    });
  const startEdit = (m: ApexMap) => setEditing({ ...m, config: { ...(m.config ?? {}) } });
  const remove = (id: string) => {
    if (!confirm("Delete map?")) return;
    setRows((rs) => rs.filter((r) => r.id !== id));
  };
  const save = () => {
    if (!editing) return;
    const exists = rows.some((r) => r.id === editing.id);
    setRows(exists ? rows.map((r) => (r.id === editing.id ? editing : r)) : [...rows, editing]);
    setEditing(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6 pr-[360px]">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold uppercase tracking-wider">Maps</h1>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search maps…"
            className="w-64 rounded-sm border border-border bg-background px-2 py-1.5 text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-sm border border-border">
            {(["grid", "table"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2 py-1 text-xs font-semibold uppercase tracking-wider ${
                  view === v ? "bg-primary/15 text-primary" : "bg-surface text-muted-foreground hover:bg-muted"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {view === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((mp) => {
              const playedIn = playedInById[mp.id] ?? 0;
              return (
                <div
                  key={mp.id}
                  className="hud-panel group overflow-hidden text-left transition hover:border-primary/50"
                >
                  <button
                    onClick={() => open(mp.id)}
                    className="block w-full text-left"
                  >
                    <div className="aspect-video w-full overflow-hidden bg-surface-2">
                      {(mp.previewImage || mp.image) ? (
                        <img src={mp.previewImage || mp.image} alt={mp.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">No image</div>
                      )}
                    </div>
                    <div className="flex items-center justify-between border-t border-border px-3 py-2">
                      <div className="text-xs font-semibold">
                        {mp.name}
                        {mp.code && <span className="ml-2 text-mono text-xs text-muted-foreground">{mp.code}</span>}
                      </div>
                      <div className="text-mono text-xs text-muted-foreground">{playedIn} games</div>
                    </div>
                  </button>
                  <div className="flex flex-wrap gap-1 border-t border-border bg-surface-2 px-3 py-2">
                    {CONFIG_KEYS.map((k) => (
                      <ConfigChip key={k} k={k} ok={Boolean(mp.config?.[k])} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1 border-t border-border px-3 py-2">
                    <button onClick={() => open(mp.id)} className="rounded-sm border border-border bg-surface px-2 py-0.5 text-xs hover:bg-muted">Open</button>
                    <button onClick={() => startEdit(mp)} className="rounded-sm border border-border bg-surface px-2 py-0.5 text-xs hover:bg-muted">Edit</button>
                    <button onClick={() => navigate({ to: "/admin/polygons", search: { mapId: mp.id } })} className="rounded-sm border border-border bg-surface px-2 py-0.5 text-xs hover:bg-muted">Polygons</button>
                    <button onClick={() => navigate({ to: "/admin/hsv", search: { mapId: mp.id } })} className="rounded-sm border border-border bg-surface px-2 py-0.5 text-xs hover:bg-muted">HSV</button>
                    <button onClick={() => remove(mp.id)} className="rounded-sm border border-destructive/40 bg-surface px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10">Delete</button>
                  </div>
                </div>
              );
            })}
            <button
              onClick={startCreate}
              className="hud-panel group flex min-h-[260px] flex-col items-center justify-center gap-2 border-2 border-dashed border-primary/60 bg-primary/10 text-primary transition hover:border-primary hover:bg-primary/20"
            >
              <span className="text-5xl font-light leading-none">+</span>
              <span className="text-xs font-semibold uppercase tracking-wider">Add map</span>
            </button>
          </div>
        ) : (
          <div className="hud-panel overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2">
                <tr className="label-eyebrow text-left text-xs">
                  <th className="px-3 py-2 w-[72px]">Image</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2 w-[80px]">Code</th>
                  <th className="px-3 py-2 w-[120px]">Used in</th>
                  <th className="px-3 py-2">Config</th>
                  <th className="px-3 py-2 w-[280px] text-right">Actions</th>
                  <th className="px-3 py-2 w-[110px] text-right">
                    <button
                      onClick={startCreate}
                      className="inline-flex items-center gap-1 rounded-sm bg-primary px-2 py-1 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110"
                    >
                      <span className="text-sm leading-none">+</span> Add
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((mp) => {
                  const playedIn = playedInById[mp.id] ?? 0;
                  return (
                    <tr key={mp.id} className="border-b border-border hover:bg-surface-2">
                      <td className="px-3 py-2">
                        {(mp.previewImage || mp.image) ? (
                          <img src={mp.previewImage || mp.image} alt={mp.name} className="h-10 w-16 rounded-sm border border-border object-cover" />
                        ) : (
                          <div className="flex h-10 w-16 items-center justify-center rounded-sm border border-dashed border-border text-xs text-muted-foreground">—</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold">{mp.name}</td>
                      <td className="px-3 py-2 text-mono text-xs">{mp.code ?? "—"}</td>
                      <td className="px-3 py-2 text-mono text-xs tabular-nums">{playedIn} matches</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {CONFIG_KEYS.map((k) => (
                            <ConfigChip key={k} k={k} ok={Boolean(mp.config?.[k])} />
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => open(mp.id)} className="rounded-sm border border-border bg-surface px-2 py-1 hover:bg-muted">Open</button>
                          <button onClick={() => startEdit(mp)} className="rounded-sm border border-border bg-surface px-2 py-1 hover:bg-muted">Edit</button>
                          <button onClick={() => navigate({ to: "/admin/polygons", search: { mapId: mp.id } })} className="rounded-sm border border-border bg-surface px-2 py-1 hover:bg-muted">Polygons</button>
                          <button onClick={() => navigate({ to: "/admin/hsv", search: { mapId: mp.id } })} className="rounded-sm border border-border bg-surface px-2 py-1 hover:bg-muted">HSV</button>
                          <button onClick={() => remove(mp.id)} className="rounded-sm border border-destructive/40 bg-surface px-2 py-1 text-destructive hover:bg-destructive/10">Delete</button>
                        </div>
                      </td>
                      <td className="px-3 py-2" />
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-muted-foreground">No maps</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EditDialog
          row={editing}
          isNew={!rows.some((r) => r.id === editing.id)}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function EditDialog({ row, isNew, onChange, onCancel, onSave }: {
  row: ApexMap; isNew: boolean;
  onChange: (r: ApexMap) => void; onCancel: () => void; onSave: () => void;
}) {
  const set = <K extends keyof ApexMap>(k: K, v: ApexMap[K]) => onChange({ ...row, [k]: v });
  const toggle = (k: MapConfigKey) => onChange({ ...row, config: { ...(row.config ?? {}), [k]: !row.config?.[k] } });
  const base = "mt-1 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-sm";
  const canSave = row.name.trim().length > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="hud-panel w-full max-w-xl max-h-[90vh] overflow-y-auto bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider">{isNew ? "New map" : "Edit map"}</h2>
        </div>
        <div className="space-y-5 p-4">
          <section>
            <div className="label-eyebrow mb-2 text-xs text-muted-foreground">Basic info</div>
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div>
                <label className="label-eyebrow text-xs">Name</label>
                <input className={base} value={row.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div>
                <label className="label-eyebrow text-xs">Code</label>
                <input
                  className={base}
                  value={row.code ?? ""}
                  placeholder={defaultCode(row.name) || "WE"}
                  onChange={(e) => set("code", e.target.value.toUpperCase().slice(0, 4) || undefined)}
                />
              </div>
            </div>
          </section>

          <section>
            <div className="label-eyebrow mb-2 text-xs text-muted-foreground">Base image</div>
            <p className="mb-2 text-xs text-muted-foreground">Используется только на аналитических страницах.</p>
            <input
              className={base}
              placeholder="https://… or imported asset URL"
              value={row.image}
              onChange={(e) => set("image", e.target.value)}
            />
            {row.image && (
              <div className="mt-2 aspect-video w-full overflow-hidden rounded-sm border border-border bg-surface-2">
                <img src={row.image} alt="preview" className="h-full w-full object-cover" />
              </div>
            )}
          </section>

          <section>
            <div className="label-eyebrow mb-2 text-xs text-muted-foreground">Preview image</div>
            <p className="mb-2 text-xs text-muted-foreground">Обложка карты в списках и карточках.</p>
            <input
              className={base}
              placeholder="https://… (необязательно, по умолчанию = base image)"
              value={row.previewImage ?? ""}
              onChange={(e) => set("previewImage", e.target.value || undefined)}
            />
            {(row.previewImage || row.image) && (
              <div className="mt-2 aspect-video w-full overflow-hidden rounded-sm border border-border bg-surface-2">
                <img src={row.previewImage || row.image} alt="cover preview" className="h-full w-full object-cover" />
              </div>
            )}
          </section>

          <section>
            <div className="label-eyebrow mb-2 text-xs text-muted-foreground">Configuration status</div>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {ALL_CONFIG_KEYS.map((k) => {
                const on = Boolean(row.config?.[k]);
                return (
                  <button
                    key={k}
                    onClick={() => toggle(k)}
                    className={`flex items-center justify-center rounded-sm border px-2 py-1.5 text-xs ${
                      on
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                        : "border-border bg-surface text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <span className="font-semibold uppercase tracking-wider">{CONFIG_LABEL[k]}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-surface-2 px-4 py-3">
          <button onClick={onCancel} className="rounded-sm border border-border bg-surface px-3 py-1.5 text-xs uppercase tracking-wider hover:bg-muted">Cancel</button>
          <button
            disabled={!canSave}
            onClick={onSave}
            className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
