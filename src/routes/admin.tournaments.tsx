import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import {
  tournaments as seedT,
  maps as seedMaps,
  type Tournament,
  type TournamentType,
  type TournamentRegion,
} from "@/lib/mock-match";
import { useAdminStore } from "@/lib/admin-store";
import { TeamLogo } from "@/components/admin/TeamLogo";

export const Route = createFileRoute("/admin/tournaments")({ component: TournamentsAdmin });

const TYPES: TournamentType[] = ["LAN", "Online", "Qualifier"];
const REGIONS: TournamentRegion[] = ["EMEA", "APAC", "North America", "South America"];
const YEARS = [1, 2, 3, 4, 5, 6];

function fmt(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}
function fmtRange(a: string, b: string) {
  return `${fmt(a)}–${fmt(b)}`;
}

function TournamentsAdmin() {
  const { matches: allMatches, teams: allTeams } = useAdminStore();
  const [rows, setRows] = useState<Tournament[]>(seedT);
  const [editing, setEditing] = useState<Tournament | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) =>
        [r.name, r.region, r.type, `year ${r.year}`].some((v) =>
          String(v).toLowerCase().includes(q),
        ),
      )
    : rows;

  const startCreate = () =>
    setEditing({
      id: `t-${Date.now()}`,
      name: "",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      year: 6,
      type: "LAN",
      region: "EMEA",
    });
  const startEdit = (e: React.MouseEvent, row: Tournament) => {
    e.stopPropagation();
    setEditing({ ...row });
  };
  const remove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Delete tournament?")) return;
    setRows(rows.filter((r) => r.id !== id));
  };
  const save = () => {
    if (!editing) return;
    const exists = rows.some((r) => r.id === editing.id);
    setRows(exists ? rows.map((r) => (r.id === editing.id ? editing : r)) : [...rows, editing]);
    setEditing(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <h1 className="text-sm font-bold uppercase tracking-wider">Tournaments</h1>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tournaments…"
            className="w-64 rounded-sm border border-border bg-background px-2 py-1.5 text-xs"
          />
          <button
            onClick={startCreate}
            className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110"
          >
            + New
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="hud-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2">
              <tr className="label-eyebrow text-left text-[10px]">
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 w-[200px]">Dates</th>
                <th className="px-3 py-2 w-[80px]">Year</th>
                <th className="px-3 py-2 w-[110px]">Type</th>
                <th className="px-3 py-2 w-[170px]">Region</th>
                <th className="px-3 py-2 w-[140px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isOpen = expandedId === row.id;
                const tMatches = allMatches.filter((m) => m.tournamentId === row.id);
                const tMapIds = Array.from(new Set(tMatches.map((m) => m.mapId)));
                const tMaps = tMapIds.map((id) => seedMaps.find((mp) => mp.id === id)).filter(Boolean) as typeof seedMaps;
                const tTeamIds = Array.from(new Set(tMatches.flatMap((m) => m.teamIds ?? [])));
                const tTeams = (tTeamIds.length ? tTeamIds : allTeams.map((t) => t.id))
                  .map((id) => allTeams.find((t) => t.id === id))
                  .filter(Boolean) as typeof allTeams;
                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={() => setExpandedId(isOpen ? null : row.id)}
                      className={`cursor-pointer border-b border-border hover:bg-surface-2 ${isOpen ? "bg-surface-2" : ""}`}
                    >
                      <td className="px-3 py-2 text-xs text-muted-foreground">{isOpen ? "▾" : "▸"}</td>
                      <td className="px-3 py-2 text-xs font-semibold">{row.name}</td>
                      <td className="px-3 py-2 text-mono text-xs tabular-nums">{fmtRange(row.startDate, row.endDate)}</td>
                      <td className="px-3 py-2 text-xs">Year {row.year}</td>
                      <td className="px-3 py-2 text-xs">
                        <TypeBadge type={row.type} />
                      </td>
                      <td className="px-3 py-2 text-xs">{row.region}</td>
                      <td className="px-3 py-2 text-right text-xs">
                        <button onClick={(e) => startEdit(e, row)} className="mr-1 rounded-sm border border-border bg-surface px-2 py-1 hover:bg-muted">Edit</button>
                        <button onClick={(e) => remove(e, row.id)} className="rounded-sm border border-destructive/40 bg-surface px-2 py-1 text-destructive hover:bg-destructive/10">Delete</button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border bg-background">
                        <td colSpan={7} className="p-0">
                          <div className="grid gap-4 p-5 md:grid-cols-3">
                            <Panel title={`Matches (${tMatches.length})`}>
                              {tMatches.length === 0 ? (
                                <Empty />
                              ) : (
                                <ul className="space-y-1">
                                  {tMatches.map((m) => {
                                    const mp = seedMaps.find((x) => x.id === m.mapId);
                                    return (
                                      <li key={m.id}>
                                        <Link
                                          to={"/admin/matches/$matchId" as "/admin/matches"}
                                          params={{ matchId: m.id } as never}
                                          className="flex items-center justify-between rounded-sm border border-border bg-surface px-2 py-1.5 text-xs hover:bg-muted"
                                        >
                                          <span className="font-semibold">{m.name}</span>
                                          <span className="text-muted-foreground">{mp?.name ?? m.mapId}</span>
                                        </Link>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </Panel>

                            <Panel title={`Teams (${tTeams.length})`}>
                              <ul className="grid grid-cols-2 gap-1">
                                {tTeams.map((t) => (
                                  <li key={t.id}>
                                    <Link
                                      to="/admin/teams/$teamId"
                                      params={{ teamId: t.id }}
                                      className="flex items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1.5 text-xs hover:bg-muted"
                                    >
                                      <TeamLogo team={t} size={22} />
                                      <span className="text-mono text-[10px] font-bold">{t.tag}</span>
                                      <span className="truncate">{t.name}</span>
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </Panel>

                            <Panel title={`Maps played (${tMaps.length})`}>
                              {tMaps.length === 0 ? (
                                <Empty />
                              ) : (
                                <ul className="space-y-2">
                                  {tMaps.map((mp) => (
                                    <li key={mp.id} className="flex items-center gap-3 rounded-sm border border-border bg-surface p-2">
                                      <img src={mp.image} alt={mp.name} className="h-12 w-16 rounded-sm object-cover" />
                                      <div className="text-xs font-semibold">{mp.name}</div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </Panel>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-muted-foreground">No tournaments</td></tr>
              )}
            </tbody>
          </table>
        </div>
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="hud-panel p-3">
      <div className="label-eyebrow mb-2 text-[10px]">{title}</div>
      {children}
    </div>
  );
}
function Empty() {
  return <div className="rounded-sm border border-dashed border-border px-2 py-4 text-center text-xs text-muted-foreground">No data</div>;
}

function TypeBadge({ type }: { type: TournamentType }) {
  const color =
    type === "LAN" ? "bg-primary/15 text-primary border-primary/30"
    : type === "Online" ? "bg-accent/15 text-accent border-accent/30"
    : "bg-muted text-foreground/80 border-border";
  return <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${color}`}>{type}</span>;
}

function EditDialog({ row, isNew, onChange, onCancel, onSave }: {
  row: Tournament; isNew: boolean;
  onChange: (r: Tournament) => void; onCancel: () => void; onSave: () => void;
}) {
  const set = <K extends keyof Tournament>(k: K, v: Tournament[K]) => onChange({ ...row, [k]: v });
  const base = "mt-1 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-sm";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="hud-panel w-full max-w-lg bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider">{isNew ? "New tournament" : "Edit tournament"}</h2>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="label-eyebrow text-[10px]">Name</label>
            <input className={base} value={row.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-eyebrow text-[10px]">Start date</label>
              <input type="date" className={base} value={row.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </div>
            <div>
              <label className="label-eyebrow text-[10px]">End date</label>
              <input type="date" className={base} value={row.endDate} onChange={(e) => set("endDate", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label-eyebrow text-[10px]">Year</label>
              <select className={base} value={row.year} onChange={(e) => set("year", Number(e.target.value))}>
                {YEARS.map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </div>
            <div>
              <label className="label-eyebrow text-[10px]">Type</label>
              <select className={base} value={row.type} onChange={(e) => set("type", e.target.value as TournamentType)}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label-eyebrow text-[10px]">Region</label>
              <select className={base} value={row.region} onChange={(e) => set("region", e.target.value as TournamentRegion)}>
                {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-surface-2 px-4 py-3">
          <button onClick={onCancel} className="rounded-sm border border-border bg-surface px-3 py-1.5 text-xs uppercase tracking-wider hover:bg-muted">Cancel</button>
          <button onClick={onSave} className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">Save</button>
        </div>
      </div>
    </div>
  );
}
