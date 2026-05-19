import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import {
  tournaments as seedT,
  maps as seedMaps,
  type Tournament,
  type TournamentType,
  type TournamentRegion,
  type MatchFull,
} from "@/lib/mock-match";
import { useAdminStore, type AnalysisProcess } from "@/lib/admin-store";
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

type TournamentStatus = "draft" | "upcoming" | "active" | "finished";
const statusStyle: Record<TournamentStatus, string> = {
  draft:    "border-border bg-surface-2 text-muted-foreground",
  upcoming: "border-primary/40 bg-primary/10 text-primary",
  active:   "border-amber-500/40 bg-amber-500/10 text-amber-400",
  finished: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
};
function StatusBadge({ s }: { s: TournamentStatus }) {
  return (
    <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider ${statusStyle[s]}`}>{s}</span>
  );
}
function deriveStatus(t: Tournament, tMatches: MatchFull[]): TournamentStatus {
  if (tMatches.length === 0) return "draft";
  const today = new Date().toISOString().slice(0, 10);
  if (today < t.startDate) return "upcoming";
  if (today > t.endDate) return "finished";
  return "active";
}
function isMatchReady(m: MatchFull): boolean {
  const mapIds = m.mapIds && m.mapIds.length > 0 ? m.mapIds : [m.mapId];
  return Boolean(m.vodLink) && mapIds.length > 0;
}
function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

type TabKey = "matches" | "teams" | "maps" | "settings";

function TournamentsAdmin() {
  const { matches: allMatches, teams: allTeams, processes } = useAdminStore();
  const [rows, setRows] = useState<Tournament[]>(seedT);
  const [editing, setEditing] = useState<Tournament | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tabById, setTabById] = useState<Record<string, TabKey>>({});
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
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold uppercase tracking-wider">Tournaments</h1>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tournaments…"
            className="w-64 rounded-sm border border-border bg-background px-2 py-1.5 text-xs"
          />
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="hud-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2">
              <tr className="label-eyebrow text-left text-xs">
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 w-[200px]">Dates</th>
                <th className="px-3 py-2 w-[80px]">Year</th>
                <th className="px-3 py-2 w-[110px]">Type</th>
                <th className="px-3 py-2 w-[110px]">Status</th>
                <th className="px-3 py-2 w-[280px]">Progress</th>
                <th className="px-3 py-2 w-[150px]">Region</th>
                <th className="px-3 py-2 w-[180px] text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span>Actions</span>
                    <button
                      onClick={startCreate}
                      className="rounded-sm bg-primary px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110"
                    >
                      + Add
                    </button>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isOpen = expandedId === row.id;
                const tMatches = allMatches.filter((m) => m.tournamentId === row.id);
                const tMapIds = Array.from(new Set(tMatches.flatMap((m) => (m.mapIds && m.mapIds.length > 0 ? m.mapIds : [m.mapId]))));
                const tMaps = tMapIds.map((id) => seedMaps.find((mp) => mp.id === id)).filter(Boolean) as typeof seedMaps;
                const tTeamIds = Array.from(new Set(tMatches.flatMap((m) => m.teamIds ?? [])));
                const tTeams = (tTeamIds.length ? tTeamIds : allTeams.map((t) => t.id))
                  .map((id) => allTeams.find((t) => t.id === id))
                  .filter(Boolean) as typeof allTeams;
                const tProcesses = processes.filter((p: AnalysisProcess) => tMatches.some((m) => m.id === p.matchId));
                const activeJobs = tProcesses.filter((p) => p.status === "queued" || p.status === "running").length;
                const failedJobs = tProcesses.filter((p) => p.status === "failed").length;
                const lastTs = tProcesses.reduce((acc, p) => Math.max(acc, p.createdAt), 0);
                const readyMatches = tMatches.filter(isMatchReady).length;
                const status = deriveStatus(row, tMatches);
                const tab: TabKey = tabById[row.id] ?? "matches";
                const setTab = (t: TabKey) => setTabById((s) => ({ ...s, [row.id]: t }));
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
                      <td className="px-3 py-2 text-xs"><TypeBadge type={row.type} /></td>
                      <td className="px-3 py-2 text-xs"><StatusBadge s={status} /></td>
                      <td className="px-3 py-2 text-xs">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="text-mono tabular-nums">{readyMatches}/{tMatches.length} ready</span>
                          {failedJobs > 0 && <span className="rounded-sm border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive">{failedJobs} failed</span>}
                          {activeJobs > 0 && <span className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-400">{activeJobs} active</span>}
                          <span className="text-muted-foreground">· last: {lastTs > 0 ? fmtRelative(lastTs) : "—"}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">{row.region}</td>
                      <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button onClick={(e) => startEdit(e, row)} className="rounded-sm border border-border bg-surface px-2 py-1 hover:bg-muted">Edit</button>
                          <button onClick={(e) => remove(e, row.id)} className="rounded-sm border border-destructive/40 bg-surface px-2 py-1 text-destructive hover:bg-destructive/10">Delete</button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border bg-background">
                        <td colSpan={9} className="p-0">
                          <div className="p-5" onClick={(e) => e.stopPropagation()}>
                            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                              <SummaryStat label="Matches" value={`${readyMatches}/${tMatches.length}`} hint="ready" />
                              <SummaryStat label="Teams" value={String(tTeams.length)} />
                              <SummaryStat label="Maps" value={String(tMaps.length)} />
                              <SummaryStat label="Active jobs" value={String(activeJobs)} hint={failedJobs > 0 ? `${failedJobs} failed` : undefined} hintTone={failedJobs > 0 ? "destructive" : undefined} />
                              <SummaryStat label="Last updated" value={lastTs > 0 ? fmtRelative(lastTs) : "—"} />
                            </div>

                            <div className="mb-3 flex flex-wrap gap-1 border-b border-border pb-2">
                              {(["matches","teams","maps","settings"] as TabKey[]).map((k) => (
                                <button
                                  key={k}
                                  onClick={() => setTab(k)}
                                  className={`rounded-sm border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${tab === k ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface text-muted-foreground hover:bg-muted"}`}
                                >
                                  {k}
                                </button>
                              ))}
                            </div>

                            {tab === "matches" && (
                              <Panel title={`Matches (${tMatches.length})`}>
                                {tMatches.length === 0 ? <Empty /> : (
                                  <ul className="space-y-1">
                                    {tMatches.map((m) => {
                                      const ids = m.mapIds && m.mapIds.length > 0 ? m.mapIds : [m.mapId];
                                      const names = Array.from(new Set(ids.map((id) => seedMaps.find((x) => x.id === id)?.name ?? id))).join(", ");
                                      return (
                                        <li key={m.id}>
                                          <Link
                                            to={"/admin/matches/$matchId" as "/admin/matches"}
                                            params={{ matchId: m.id } as never}
                                            className="flex items-center justify-between rounded-sm border border-border bg-surface px-2 py-1.5 text-xs hover:bg-muted"
                                          >
                                            <span className="font-semibold">{m.name}</span>
                                            <span className="flex items-center gap-2 text-muted-foreground">
                                              <span>{names}</span>
                                              <span className={`rounded-sm border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${isMatchReady(m) ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-border bg-surface-2 text-muted-foreground"}`}>{isMatchReady(m) ? "ready" : "draft"}</span>
                                            </span>
                                          </Link>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </Panel>
                            )}

                            {tab === "teams" && (
                              <Panel title={`Teams (${tTeams.length})`}>
                                <ul className="grid grid-cols-2 gap-1 md:grid-cols-3 lg:grid-cols-4">
                                  {tTeams.map((t) => (
                                    <li key={t.id}>
                                      <Link
                                        to="/admin/teams/$teamId"
                                        params={{ teamId: t.id }}
                                        className="flex items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1.5 text-xs hover:bg-muted"
                                      >
                                        <TeamLogo team={t} size={22} />
                                        <span className="text-mono text-xs font-bold">{t.tag}</span>
                                        <span className="truncate">{t.name}</span>
                                      </Link>
                                    </li>
                                  ))}
                                </ul>
                              </Panel>
                            )}

                            {tab === "maps" && (
                              <Panel title={`Maps used (${tMaps.length})`}>
                                {tMaps.length === 0 ? <Empty /> : (
                                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                    {tMaps.map((mp) => (
                                      <li key={mp.id} className="flex items-center gap-3 rounded-sm border border-border bg-surface p-2">
                                        <img src={mp.image} alt={mp.name} className="h-12 w-16 rounded-sm object-cover" />
                                        <div className="text-xs font-semibold">{mp.name}</div>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </Panel>
                            )}

                            {tab === "settings" && (
                              <Panel title="Settings">
                                <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-1.5 text-xs">
                                  <dt className="text-muted-foreground">Status</dt><dd><StatusBadge s={status} /></dd>
                                  <dt className="text-muted-foreground">Type</dt><dd><TypeBadge type={row.type} /></dd>
                                  <dt className="text-muted-foreground">Region</dt><dd>{row.region}</dd>
                                  <dt className="text-muted-foreground">Year</dt><dd>Year {row.year}</dd>
                                  <dt className="text-muted-foreground">Dates</dt><dd className="text-mono tabular-nums">{fmtRange(row.startDate, row.endDate)}</dd>
                                  <dt className="text-muted-foreground">ID</dt><dd className="text-mono text-xs text-muted-foreground">{row.id}</dd>
                                </dl>
                                <div className="mt-3 flex gap-2">
                                  <button onClick={(e) => startEdit(e, row)} className="rounded-sm border border-border bg-surface px-2 py-1 text-xs uppercase tracking-wider hover:bg-muted">Edit tournament</button>
                                  <button onClick={(e) => remove(e, row.id)} className="rounded-sm border border-destructive/40 bg-surface px-2 py-1 text-xs uppercase tracking-wider text-destructive hover:bg-destructive/10">Delete</button>
                                </div>
                              </Panel>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-muted-foreground">No tournaments</td></tr>
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
      <div className="label-eyebrow mb-2 text-xs">{title}</div>
      {children}
    </div>
  );
}
function Empty() {
  return <div className="rounded-sm border border-dashed border-border px-2 py-4 text-center text-xs text-muted-foreground">No data</div>;
}

function SummaryStat({ label, value, hint, hintTone }: { label: string; value: string; hint?: string; hintTone?: "destructive" }) {
  return (
    <div className="hud-panel p-2">
      <div className="label-eyebrow text-xs">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-mono text-sm font-bold tabular-nums">{value}</span>
        {hint && <span className={`text-xs ${hintTone === "destructive" ? "text-destructive" : "text-muted-foreground"}`}>{hint}</span>}
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: TournamentType }) {
  const color =
    type === "LAN" ? "bg-primary/15 text-primary border-primary/30"
    : type === "Online" ? "bg-success/20 text-success border-success/40"
    : "bg-cyan/15 text-cyan border-cyan/40";
  return <span className={`rounded-sm border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${color}`}>{type}</span>;
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
            <label className="label-eyebrow text-xs">Name</label>
            <input className={base} value={row.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-eyebrow text-xs">Start date</label>
              <input type="date" className={base} value={row.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </div>
            <div>
              <label className="label-eyebrow text-xs">End date</label>
              <input type="date" className={base} value={row.endDate} onChange={(e) => set("endDate", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label-eyebrow text-xs">Year</label>
              <select className={base} value={row.year} onChange={(e) => set("year", Number(e.target.value))}>
                {YEARS.map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </div>
            <div>
              <label className="label-eyebrow text-xs">Type</label>
              <select className={base} value={row.type} onChange={(e) => set("type", e.target.value as TournamentType)}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label-eyebrow text-xs">Region</label>
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
