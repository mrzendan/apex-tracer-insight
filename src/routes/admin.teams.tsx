import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useAdminStore, setTeams } from "@/lib/admin-store";
import type { Team } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";

export const Route = createFileRoute("/admin/teams")({ component: TeamsAdmin });

function TeamsAdmin() {
  const { teams, matches, tournaments } = useAdminStore();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Team | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">("all");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/admin/teams" && pathname !== "/admin/teams/") {
    return <Outlet />;
  }

  const today = new Date().toISOString().slice(0, 10);
  const tIndex = new Map(tournaments.map((t) => [t.id, t]));

  function teamSchedule(teamId: string) {
    const ms = matches.filter((m) => m.teamIds?.includes(teamId));
    type Item = { match: typeof ms[number]; tour: typeof tournaments[number] | undefined; start: string; end: string };
    const items: Item[] = ms.map((m) => {
      const tour = tIndex.get(m.tournamentId);
      return { match: m, tour, start: tour?.startDate ?? "", end: tour?.endDate ?? "" };
    });
    const live = items.find((i) => i.start && i.end && i.start <= today && today <= i.end);
    const past = items
      .filter((i) => i.end && i.end < today)
      .sort((a, b) => b.end.localeCompare(a.end))[0];
    const upcoming = items
      .filter((i) => i.start && i.start > today)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    return { live, last: past ?? items[0], next: live ?? upcoming };
  }

  const q = query.trim().toLowerCase();
  const filtered = teams.filter((t) => {
    const st = t.status ?? "active";
    if (statusFilter !== "all" && st !== statusFilter) return false;
    if (!q) return true;
    return [t.tag, t.name, ...(t.players ?? [])].some((v) => String(v).toLowerCase().includes(q));
  });

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
      status: "active",
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
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold uppercase tracking-wider">Teams</h1>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teams or players…"
            className="w-64 rounded-sm border border-border bg-background px-2 py-1.5 text-xs"
          />
          <div className="flex items-center gap-1 rounded-sm border border-border bg-background p-0.5">
            {(["all", "active", "archived"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={
                  "rounded-sm px-2 py-1 text-xs font-semibold uppercase tracking-wider " +
                  (statusFilter === s
                    ? "bg-primary/15 text-primary"
                    : "bg-surface text-muted-foreground hover:text-foreground")
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <div className="hud-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2">
              <tr className="label-eyebrow text-left text-xs">
                <th className="px-3 py-2 w-[64px]">Logo</th>
                <th className="px-3 py-2 w-[100px]">Tag</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 w-[110px]">Status</th>
                <th className="px-3 py-2 w-[260px]">Last match</th>
                <th className="px-3 py-2 w-[260px]">Next match</th>
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
              {filtered.map((t) => {
                const sched = teamSchedule(t.id);
                const st = t.status ?? "active";
                return (
                  <tr
                    key={t.id}
                    onClick={() => navigate({ to: "/admin/teams/$teamId" as "/admin/teams", params: { teamId: t.id } as never })}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-3 py-2"><TeamLogo team={t} size={32} /></td>
                    <td className="px-3 py-2 text-xs text-mono font-bold">{t.tag}</td>
                    <td className="px-3 py-2 text-xs">{t.name}</td>
                    <td className="px-3 py-2 text-xs">
                      <span
                        className={
                          "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider " +
                          (st === "active"
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                            : "border-border bg-surface text-muted-foreground")
                        }
                      >
                        <span className={"inline-block h-1.5 w-1.5 rounded-full " + (st === "active" ? "bg-emerald-400" : "bg-muted-foreground")} />
                        {st}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {sched.last ? (
                        <div>
                          <div className="font-semibold truncate">{sched.last.match.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{sched.last.tour?.name ?? "—"}</div>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {sched.next ? (
                        <div className={sched.live ? "rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1" : ""}>
                          <div className="flex items-center gap-1.5 font-semibold truncate">
                            {sched.live && (
                              <span className="inline-flex items-center gap-1 rounded-sm bg-destructive px-1 py-[1px] text-xs font-bold uppercase tracking-wider text-destructive-foreground">
                                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                                LIVE
                              </span>
                            )}
                            <span className="truncate">{sched.next.match.name}</span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{sched.next.tour?.name ?? "—"}</div>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      <button onClick={(e) => startEdit(e, t)} className="mr-1 rounded-sm border border-border bg-surface px-2 py-1 hover:bg-muted">Edit</button>
                      <button onClick={(e) => remove(e, t.id)} className="rounded-sm border border-destructive/40 bg-surface px-2 py-1 text-destructive hover:bg-destructive/10">Delete</button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-muted-foreground">No teams</td></tr>
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
  const status = row.status ?? "active";
  // Determine which logo variant is actually shown right now (matches TeamLogo fallback order).
  const activeKey: "logo" | "logoLight" | "logoDark" =
    row.logoDark ? "logoDark" : row.logoLight ? "logoLight" : "logo";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="hud-panel w-full max-w-lg bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider">{isNew ? "New team" : "Edit team"}</h2>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto overflow-x-hidden p-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label-eyebrow text-xs">Tag</label>
              <input className={base} value={row.tag} onChange={(e) => set("tag", e.target.value.toUpperCase())} />
            </div>
            <div className="col-span-2">
              <label className="label-eyebrow text-xs">Name</label>
              <input className={base} value={row.name} onChange={(e) => set("name", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label-eyebrow text-xs">Status</label>
            <div className="mt-1 flex items-center gap-1 rounded-sm border border-border bg-background p-0.5 w-fit">
              {(["active", "archived"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set("status", s)}
                  className={
                    "rounded-sm px-3 py-1 text-xs font-semibold uppercase tracking-wider " +
                    (status === s
                      ? s === "active"
                      ? "bg-primary/15 text-primary"
                        : "border border-border bg-muted text-foreground"
                      : "bg-surface text-muted-foreground hover:text-foreground")
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <LogoField row={row} setKey={set} fieldKey="logo" label="Default logo" hint="Used when a theme-specific variant is missing." isActive={activeKey === "logo"} />
            <LogoField row={row} setKey={set} fieldKey="logoDark" label="Dark theme logo" hint="Shown on dark / OLED themes." isActive={activeKey === "logoDark"} />
            <LogoField row={row} setKey={set} fieldKey="logoLight" label="Light theme logo" hint="Shown on light theme." isActive={activeKey === "logoLight"} />
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

function LogoField({
  row,
  setKey,
  fieldKey,
  label,
  hint,
  isActive,
}: {
  row: Team;
  setKey: <K extends keyof Team>(k: K, v: Team[K]) => void;
  fieldKey: "logo" | "logoLight" | "logoDark";
  label: string;
  hint: string;
  isActive: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const value = row[fieldKey] ?? "";
  const previewTeam = {
    ...row,
    logo: fieldKey === "logo" ? value : row.logo,
    logoLight: fieldKey === "logoLight" ? value : undefined,
    logoDark: fieldKey === "logoDark" ? value : undefined,
  } as Team;
  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setKey(fieldKey, String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <div className="rounded-sm border border-border bg-surface-2/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="label-eyebrow text-xs">{label}</label>
        {isActive && value && (
          <span className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
            In use
          </span>
        )}
      </div>
      <div className="mt-2 flex items-stretch gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-sm border border-border bg-background">
          {value ? (
            <TeamLogo team={previewTeam} size={56} />
          ) : (
            <span className="text-xs text-muted-foreground">Preview</span>
          )}
        </div>
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            readFile(e.dataTransfer.files?.[0]);
          }}
          className={
            "flex flex-1 cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed px-3 py-2 text-center text-xs transition " +
            (dragOver
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border bg-background text-muted-foreground hover:border-primary/60 hover:text-foreground")
          }
        >
          <div className="font-semibold uppercase tracking-wider">Drop logo here</div>
          <div className="text-xs">or click to choose file</div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => readFile(e.target.files?.[0])}
          />
        </div>
      </div>
      <input
        className="mt-2 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-mono text-xs"
        placeholder="https://… or paste URL"
        value={value}
        onChange={(e) => setKey(fieldKey, e.target.value)}
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{hint}</div>
        {value && (
          <button type="button" onClick={() => setKey(fieldKey, "")} className="rounded-sm border border-border bg-surface px-2 py-0.5 text-xs hover:bg-muted">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}