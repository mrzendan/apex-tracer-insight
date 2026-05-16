import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAdminStore, setTeams } from "@/lib/admin-store";
import type { Team } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";

export const Route = createFileRoute("/admin/teams")({ component: TeamsAdmin });

function TeamsAdmin() {
  const { teams } = useAdminStore();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Team | null>(null);

  const startCreate = () =>
    setEditing({
      id: `team-${Date.now()}`,
      tag: "",
      name: "",
      color: "#ffffff",
      logo: "",
      players: [],
      placement: teams.length + 1,
      kills: 0,
      alive: true,
    });
  const startEdit = (e: React.MouseEvent, t: Team) => {
    e.stopPropagation();
    setEditing({ ...t });
  };
  const remove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Delete team?")) return;
    setTeams(teams.filter((t) => t.id !== id));
  };
  const save = () => {
    if (!editing) return;
    const exists = teams.some((t) => t.id === editing.id);
    setTeams(exists ? teams.map((t) => (t.id === editing.id ? editing : t)) : [...teams, editing]);
    setEditing(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <h1 className="text-sm font-bold uppercase tracking-wider">Teams</h1>
        <button onClick={startCreate} className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">
          + New
        </button>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <div className="hud-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2">
              <tr className="label-eyebrow text-left text-[10px]">
                <th className="px-3 py-2 w-[100px]">Tag</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 w-[120px]">Logo</th>
                <th className="px-3 py-2 w-[160px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => navigate({ to: "/admin/teams/$teamId" as "/admin/teams", params: { teamId: t.id } as never })}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2"
                >
                  <td className="px-3 py-2 text-xs text-mono font-bold">{t.tag}</td>
                  <td className="px-3 py-2 text-xs">{t.name}</td>
                  <td className="px-3 py-2"><TeamLogo team={t} size={28} /></td>
                  <td className="px-3 py-2 text-right text-xs">
                    <button onClick={(e) => startEdit(e, t)} className="mr-1 rounded-sm border border-border bg-surface px-2 py-1 hover:bg-muted">Edit</button>
                    <button onClick={(e) => remove(e, t.id)} className="rounded-sm border border-destructive/40 bg-surface px-2 py-1 text-destructive hover:bg-destructive/10">Delete</button>
                  </td>
                </tr>
              ))}
              {teams.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">No teams</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {editing && <TeamDialog row={editing} isNew={!teams.some((t) => t.id === editing.id)} onChange={setEditing} onCancel={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function TeamDialog({ row, isNew, onChange, onCancel, onSave }: {
  row: Team; isNew: boolean;
  onChange: (r: Team) => void; onCancel: () => void; onSave: () => void;
}) {
  const set = <K extends keyof Team>(k: K, v: Team[K]) => onChange({ ...row, [k]: v });
  const base = "mt-1 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-sm";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="hud-panel w-full max-w-md bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider">{isNew ? "New team" : "Edit team"}</h2>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label-eyebrow text-[10px]">Tag</label>
              <input className={base} value={row.tag} onChange={(e) => set("tag", e.target.value.toUpperCase())} />
            </div>
            <div className="col-span-2">
              <label className="label-eyebrow text-[10px]">Name</label>
              <input className={base} value={row.name} onChange={(e) => set("name", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label-eyebrow text-[10px]">Logo URL</label>
            <input className={base + " text-mono text-xs"} placeholder="https://..." value={row.logo ?? ""} onChange={(e) => set("logo", e.target.value)} />
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              Preview: <TeamLogo team={{ ...row, logo: row.logo ?? "" }} size={36} />
              {!row.logo && <span>Site logo fallback in use</span>}
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