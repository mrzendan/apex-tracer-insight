import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { useAdminStore, setMatches, updateMatch } from "@/lib/admin-store";
import { maps as allMaps, type MatchFull, gameIdFor } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";

export const Route = createFileRoute("/admin/matches")({ component: MatchesAdmin });

function MatchesAdmin() {
  const { matches, tournaments, teams } = useAdminStore();
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MatchFull | null>(null);
  const [vodTeamId, setVodTeamId] = useState<{ matchId: string; teamId: string } | null>(null);
  const [vodValue, setVodValue] = useState("");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filteredMatches = q
    ? matches.filter((m) => {
        const tn = tournaments.find((t) => t.id === m.tournamentId)?.name ?? "";
        const mp = allMaps.find((x) => x.id === m.mapId)?.name ?? "";
        return [m.name, m.id, tn, mp].some((v) => v.toLowerCase().includes(q));
      })
    : matches;

  const startCreate = () =>
    setEditing({
      id: `m-${Date.now()}`,
      name: "",
      tournamentId: tournaments[0]?.id ?? "",
      mapId: allMaps[0]?.id ?? "",
      durationSec: 1200,
      vodLink: "",
      mapIds: [allMaps[0]?.id ?? ""],
      teamIds: teams.map((t) => t.id),
      teamVods: {},
    });
  const startEdit = (e: React.MouseEvent, m: MatchFull) => {
    e.stopPropagation();
    setEditing({ ...m });
  };
  const remove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Delete match?")) return;
    setMatches(matches.filter((m) => m.id !== id));
  };
  const save = () => {
    if (!editing) return;
    const exists = matches.some((m) => m.id === editing.id);
    setMatches(exists ? matches.map((m) => (m.id === editing.id ? editing : m)) : [...matches, editing]);
    setEditing(null);
  };

  const openVod = (e: React.MouseEvent, matchId: string, teamId: string, current: string) => {
    e.stopPropagation();
    setVodTeamId({ matchId, teamId });
    setVodValue(current ?? "");
  };
  const saveVod = () => {
    if (!vodTeamId) return;
    const m = matches.find((x) => x.id === vodTeamId.matchId);
    if (m) {
      updateMatch(m.id, { teamVods: { ...(m.teamVods ?? {}), [vodTeamId.teamId]: vodValue } });
    }
    setVodTeamId(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold uppercase tracking-wider">Matches</h1>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search matches…"
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
                <th className="px-3 py-2 w-[120px]">ID</th>
                <th className="px-3 py-2">Match</th>
                <th className="px-3 py-2">Tournament</th>
                <th className="px-3 py-2">Map</th>
                <th className="px-3 py-2 w-[100px] text-right">Duration</th>
                <th className="px-3 py-2 w-[180px]">VOD link</th>
                <th className="px-3 py-2 w-[200px] text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span>Actions</span>
                    <button onClick={startCreate} className="rounded-sm bg-primary px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">
                      + Add
                    </button>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredMatches.map((m) => {
                const isOpen = expandedId === m.id;
                const tournament = tournaments.find((t) => t.id === m.tournamentId);
                const mapIds = m.mapIds && m.mapIds.length > 0 ? m.mapIds : [m.mapId];
                const matchTeams = (m.teamIds ?? teams.map((t) => t.id))
                  .map((id) => teams.find((t) => t.id === id))
                  .filter(Boolean) as typeof teams;
                const topTeams = [...matchTeams].sort((a, b) => a.placement - b.placement).slice(0, 3);
                const mm = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
                return (
                  <Fragment key={m.id}>
                    <tr
                      onClick={() => setExpandedId(isOpen ? null : m.id)}
                      className={`cursor-pointer border-b border-border hover:bg-surface-2 ${isOpen ? "bg-surface-2" : ""}`}
                    >
                      <td className="px-3 py-2 text-xs text-muted-foreground">{isOpen ? "▾" : "▸"}</td>
                      <td className="px-3 py-2 text-mono text-xs text-muted-foreground">{m.id}</td>
                      <td className="px-3 py-2 text-xs font-semibold">{m.name}</td>
                      <td className="px-3 py-2 text-xs">{tournament?.name ?? m.tournamentId}</td>
                      <td className="px-3 py-2 text-xs">
                        {Array.from(new Set(mapIds))
                          .map((id) => allMaps.find((x) => x.id === id)?.name ?? id)
                          .join(", ")}
                      </td>
                      <td className="px-3 py-2 text-right text-mono text-xs tabular-nums">{Math.floor(m.durationSec / 60)}:{(m.durationSec % 60).toString().padStart(2, "0")}</td>
                      <td className="px-3 py-2 text-xs">
                        {m.vodLink ? (
                          <a href={m.vodLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 truncate text-primary hover:underline">
                            <YoutubeIcon className="h-3 w-3" /> <span className="max-w-[120px] truncate">{m.vodLink}</span>
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs">
                        <button onClick={(e) => { e.stopPropagation(); navigate({ to: "/admin/matches/$matchId" as "/admin/matches", params: { matchId: m.id } as never }); }} className="mr-1 rounded-sm border border-border bg-surface px-2 py-1 hover:bg-muted">Open</button>
                        <button onClick={(e) => startEdit(e, m)} className="mr-1 rounded-sm border border-border bg-surface px-2 py-1 hover:bg-muted">Edit</button>
                        <button onClick={(e) => remove(e, m.id)} className="rounded-sm border border-destructive/40 bg-surface px-2 py-1 text-destructive hover:bg-destructive/10">Delete</button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border bg-background">
                        <td colSpan={8} className="p-0">
                          <div className="grid gap-4 p-5 md:grid-cols-3">
                            <div className="hud-panel p-3">
                              <div className="label-eyebrow mb-2 text-xs">Top 3 teams</div>
                              <ol className="space-y-1.5">
                                {topTeams.map((t, i) => (
                                  <li key={t.id}>
                                    <Link
                                      to="/admin/teams/$teamId"
                                      params={{ teamId: t.id }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="flex items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1.5 text-xs hover:bg-muted"
                                    >
                                      <span className="w-5 text-mono text-xs text-muted-foreground">#{i + 1}</span>
                                      <TeamLogo team={t} size={22} />
                                      <span className="flex-1 truncate font-semibold">{t.tag} · {t.name}</span>
                                      <span className="text-mono text-xs tabular-nums text-muted-foreground">{t.kills}K</span>
                                    </Link>
                                  </li>
                                ))}
                              </ol>
                            </div>
                            <div className="hud-panel p-3">
                              <div className="label-eyebrow mb-2 text-xs">Map order ({mapIds.length})</div>
                              <ol className="space-y-2">
                                {mapIds.map((id, i) => {
                                  const mp = allMaps.find((x) => x.id === id);
                                  if (!mp) return null;
                                  const gameId = gameIdFor(m.id, i);
                                  const dur = m.gameDurations?.[i] ?? m.durationSec;
                                  return (
                                    <li key={`${id}-${i}`} className="flex items-center gap-3 rounded-sm border border-border bg-surface p-2">
                                      <span className="text-mono text-xs text-muted-foreground">#{i + 1}</span>
                                      <Link
                                        to="/games/$gameId"
                                        params={{ gameId }}
                                        onClick={(e) => e.stopPropagation()}
                                        title={`Open game ${i + 1}`}
                                        className="flex flex-1 items-center gap-3 hover:opacity-80"
                                      >
                                        <img src={mp.image} alt={mp.name} className="h-10 w-14 rounded-sm object-cover" />
                                        <div className="flex-1 text-xs font-semibold hover:underline">{mp.name}</div>
                                        <span className="text-mono text-xs tabular-nums text-muted-foreground">{mm(dur)}</span>
                                      </Link>
                                      <div className="flex flex-col gap-0.5">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); if (i === 0) return; const next = [...mapIds]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; updateMatch(m.id, { mapIds: next, mapId: next[0] }); }}
                                          disabled={i === 0}
                                          className="rounded-sm border border-border bg-surface px-1 text-xs hover:bg-muted disabled:opacity-30"
                                        >▲</button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); if (i === mapIds.length - 1) return; const next = [...mapIds]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; updateMatch(m.id, { mapIds: next, mapId: next[0] }); }}
                                          disabled={i === mapIds.length - 1}
                                          className="rounded-sm border border-border bg-surface px-1 text-xs hover:bg-muted disabled:opacity-30"
                                        >▼</button>
                                      </div>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); const next = mapIds.filter((_, idx) => idx !== i); if (next.length === 0) return; updateMatch(m.id, { mapIds: next, mapId: next[0] }); }}
                                        className="rounded-sm border border-destructive/40 bg-surface px-1.5 text-xs text-destructive hover:bg-destructive/10"
                                      >×</button>
                                    </li>
                                  );
                                })}
                              </ol>
                              <div className="mt-2 flex items-center gap-2">
                                <select
                                  defaultValue=""
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    const v = e.target.value;
                                    if (!v) return;
                                    const next = [...mapIds, v];
                                    updateMatch(m.id, { mapIds: next, mapId: next[0] });
                                    e.currentTarget.value = "";
                                  }}
                                  className="flex-1 rounded-sm border border-border bg-background px-2 py-1 text-xs"
                                >
                                  <option value="">+ Add map…</option>
                                  {allMaps.map((mp) => <option key={mp.id} value={mp.id}>{mp.name}</option>)}
                                </select>
                              </div>
                            </div>
                            <div className="hud-panel p-3">
                              <div className="label-eyebrow mb-2 text-xs">Teams ({matchTeams.length}) · POV VODs</div>
                              <ul className="grid grid-cols-2 gap-1">
                                {matchTeams.map((t) => {
                                  const url = m.teamVods?.[t.id] ?? "";
                                  return (
                                    <li key={t.id} className="flex items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1.5 text-xs">
                                      <TeamLogo team={t} size={20} />
                                      <span className="flex-1 truncate font-semibold">{t.tag}</span>
                                      <button
                                        onClick={(e) => openVod(e, m.id, t.id, url)}
                                        title={url ? `Edit POV: ${url}` : "Add POV VOD link"}
                                        className={`rounded-sm border px-1.5 py-0.5 ${url ? "border-primary/40 text-primary hover:bg-primary/10" : "border-border text-muted-foreground hover:bg-muted"}`}
                                      >
                                        <YoutubeIcon className="h-3.5 w-3.5" />
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filteredMatches.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-muted-foreground">No matches</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && <MatchDialog row={editing} isNew={!matches.some((m) => m.id === editing.id)} onChange={setEditing} onCancel={() => setEditing(null)} onSave={save} />}

      {vodTeamId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setVodTeamId(null)}>
          <div className="hud-panel w-full max-w-md bg-surface" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider"><YoutubeIcon className="h-4 w-4 text-primary" /> POV VOD link</h2>
            </div>
            <div className="p-4">
              <label className="label-eyebrow text-xs">YouTube URL</label>
              <input autoFocus value={vodValue} onChange={(e) => setVodValue(e.target.value)} placeholder="https://youtube.com/watch?v=..." className="mt-1 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-sm text-mono" />
            </div>
            <div className="flex justify-end gap-2 border-t border-border bg-surface-2 px-4 py-3">
              <button onClick={() => setVodTeamId(null)} className="rounded-sm border border-border bg-surface px-3 py-1.5 text-xs uppercase tracking-wider hover:bg-muted">Cancel</button>
              <button onClick={saveVod} className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MatchDialog({ row, isNew, onChange, onCancel, onSave }: {
  row: MatchFull; isNew: boolean;
  onChange: (r: MatchFull) => void; onCancel: () => void; onSave: () => void;
}) {
  const { tournaments, teams } = useAdminStore();
  const set = <K extends keyof MatchFull>(k: K, v: MatchFull[K]) => onChange({ ...row, [k]: v });
  const base = "mt-1 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-sm";
  const mapIds = row.mapIds ?? [row.mapId];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="hud-panel w-full max-w-xl bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider">{isNew ? "New match" : "Edit match"}</h2>
        </div>
        <div className="max-h-[70vh] space-y-3 overflow-auto p-4">
          <div>
            <label className="label-eyebrow text-xs">Name</label>
            <input className={base} value={row.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-eyebrow text-xs">Tournament</label>
              <select className={base} value={row.tournamentId} onChange={(e) => set("tournamentId", e.target.value)}>
                {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label-eyebrow text-xs">Duration (sec)</label>
              <input type="number" className={base} value={row.durationSec} onChange={(e) => set("durationSec", Number(e.target.value))} />
            </div>
          </div>
          <div>
            <label className="label-eyebrow text-xs">VOD link</label>
            <input className={base + " text-mono text-xs"} placeholder="https://..." value={row.vodLink ?? ""} onChange={(e) => set("vodLink", e.target.value)} />
          </div>
          <div>
            <label className="label-eyebrow text-xs">Map order</label>
            <div className="mt-1 space-y-1">
              {mapIds.map((id, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-mono text-xs w-6 text-muted-foreground">#{i + 1}</span>
                  <select
                    className={base.replace("mt-1 ", "") + " flex-1"}
                    value={id}
                    onChange={(e) => {
                      const next = [...mapIds];
                      next[i] = e.target.value;
                      set("mapIds", next);
                      if (i === 0) set("mapId", e.target.value);
                    }}
                  >
                    {allMaps.map((mp) => <option key={mp.id} value={mp.id}>{mp.name}</option>)}
                  </select>
                  <button type="button" onClick={() => set("mapIds", mapIds.filter((_, idx) => idx !== i))} className="rounded-sm border border-border bg-surface px-2 py-1 text-xs hover:bg-muted">Remove</button>
                </div>
              ))}
              <button type="button" onClick={() => set("mapIds", [...mapIds, allMaps[0]?.id ?? ""])} className="rounded-sm border border-border bg-surface px-2 py-1 text-xs hover:bg-muted">+ Add map</button>
            </div>
          </div>
          <div>
            <label className="label-eyebrow text-xs">Teams</label>
            <div className="mt-1 flex flex-wrap gap-1">
              {teams.map((t) => {
                const on = (row.teamIds ?? []).includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => set("teamIds", on ? (row.teamIds ?? []).filter((x) => x !== t.id) : [...(row.teamIds ?? []), t.id])}
                    className={`flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs ${on ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface text-muted-foreground hover:bg-muted"}`}
                  >
                    <TeamLogo team={t} size={14} /> {t.tag}
                  </button>
                );
              })}
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

function YoutubeIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M23.5 6.5a3 3 0 0 0-2.1-2.1C19.5 4 12 4 12 4s-7.5 0-9.4.4A3 3 0 0 0 .5 6.5 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.5 3 3 0 0 0 2.1 2.1C4.5 20 12 20 12 20s7.5 0 9.4-.4a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.5zM9.75 15.5v-7l6 3.5-6 3.5z" />
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border bg-surface px-2 py-1">
      <div className="label-eyebrow text-xs">{label}</div>
      <div className="text-mono text-xs tabular-nums">{value}</div>
    </div>
  );
}