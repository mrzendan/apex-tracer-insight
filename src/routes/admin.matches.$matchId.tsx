import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAdminStore, updateMatch } from "@/lib/admin-store";
import { maps as allMaps } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";

export const Route = createFileRoute("/admin/matches/$matchId")({ component: MatchDetail });

function MatchDetail() {
  const { matchId } = Route.useParams();
  const { matches, tournaments, teams } = useAdminStore();
  const navigate = useNavigate();
  const match = matches.find((m) => m.id === matchId);
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const [vodValue, setVodValue] = useState("");

  if (!match) {
    return (
      <div className="p-6 text-sm">
        Match not found. <Link to="/admin/matches" className="text-primary underline">Back to matches</Link>
      </div>
    );
  }

  const tournament = tournaments.find((t) => t.id === match.tournamentId);
  const mapIds = match.mapIds && match.mapIds.length > 0 ? match.mapIds : [match.mapId];
  const matchTeams = (match.teamIds ?? teams.map((t) => t.id))
    .map((id) => teams.find((t) => t.id === id))
    .filter(Boolean) as typeof teams;

  const openVod = (teamId: string) => {
    setEditingTeam(teamId);
    setVodValue(match.teamVods?.[teamId] ?? "");
  };
  const saveVod = () => {
    if (!editingTeam) return;
    updateMatch(match.id, { teamVods: { ...(match.teamVods ?? {}), [editingTeam]: vodValue } });
    setEditingTeam(null);
  };
  const setVodLink = (v: string) => updateMatch(match.id, { vodLink: v });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-6">
        <button onClick={() => navigate({ to: "/admin/matches" })} className="text-mono rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-muted">← Matches</button>
        <h1 className="text-sm font-bold uppercase tracking-wider">{match.name}</h1>
        <span className="text-[10px] text-muted-foreground">{tournament?.name}</span>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="hud-panel p-3">
            <div className="label-eyebrow mb-2 text-[10px]">VOD link (broadcast)</div>
            <input
              className="w-full rounded-sm border border-border bg-background px-2 py-1.5 text-sm text-mono"
              placeholder="https://youtube.com/watch?v=..."
              value={match.vodLink ?? ""}
              onChange={(e) => setVodLink(e.target.value)}
            />
          </div>
          <div className="hud-panel p-3">
            <div className="label-eyebrow mb-2 text-[10px]">Map order ({mapIds.length})</div>
            <ol className="space-y-2">
              {mapIds.map((id, i) => {
                const mp = allMaps.find((x) => x.id === id);
                if (!mp) return null;
                return (
                  <li key={`${id}-${i}`} className="flex items-center gap-3 rounded-sm border border-border bg-surface p-2">
                    <span className="text-mono text-[10px] text-muted-foreground">#{i + 1}</span>
                    <img src={mp.image} alt={mp.name} className="h-10 w-14 rounded-sm object-cover" />
                    <div className="text-xs font-semibold">{mp.name}</div>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="hud-panel p-3 md:col-span-2">
            <div className="label-eyebrow mb-2 text-[10px]">Teams ({matchTeams.length}) · POV VOD links</div>
            <ul className="grid gap-1 md:grid-cols-2 lg:grid-cols-3">
              {matchTeams.map((t) => {
                const url = match.teamVods?.[t.id] ?? "";
                return (
                  <li key={t.id} className="flex items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1.5 text-xs">
                    <TeamLogo team={t} size={22} />
                    <Link
                      to="/admin/teams/$teamId"
                      params={{ teamId: t.id }}
                      className="flex-1 truncate font-semibold hover:underline"
                    >
                      {t.tag} · {t.name}
                    </Link>
                    {url && <span className="max-w-[160px] truncate text-[10px] text-muted-foreground">{url}</span>}
                    <button
                      onClick={() => openVod(t.id)}
                      className={`rounded-sm border px-1.5 py-0.5 ${url ? "border-primary/40 text-primary hover:bg-primary/10" : "border-border text-muted-foreground hover:bg-muted"}`}
                      title={url ? `Edit POV` : `Add POV VOD`}
                    >
                      <YoutubeIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      {editingTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditingTeam(null)}>
          <div className="hud-panel w-full max-w-md bg-surface" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider"><YoutubeIcon className="h-4 w-4 text-primary" /> POV VOD link</h2>
            </div>
            <div className="p-4">
              <label className="label-eyebrow text-[10px]">YouTube URL</label>
              <input autoFocus value={vodValue} onChange={(e) => setVodValue(e.target.value)} className="mt-1 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-sm text-mono" />
            </div>
            <div className="flex justify-end gap-2 border-t border-border bg-surface-2 px-4 py-3">
              <button onClick={() => setEditingTeam(null)} className="rounded-sm border border-border bg-surface px-3 py-1.5 text-xs uppercase tracking-wider hover:bg-muted">Cancel</button>
              <button onClick={saveVod} className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">Save</button>
            </div>
          </div>
        </div>
      )}
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