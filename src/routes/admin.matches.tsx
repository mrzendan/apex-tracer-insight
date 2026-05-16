import { createFileRoute } from "@tanstack/react-router";
import { matches, tournaments, maps } from "@/lib/mock-match";

export const Route = createFileRoute("/admin/matches")({ component: MatchesAdmin });

function MatchesAdmin() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <h1 className="text-sm font-bold uppercase tracking-wider">Matches</h1>
        <button className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">
          + New match
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="hud-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2">
              <tr className="text-left label-eyebrow text-[10px]">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Match</th>
                <th className="px-3 py-2">Tournament</th>
                <th className="px-3 py-2">Map</th>
                <th className="px-3 py-2 text-right">Duration</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => {
                const t = tournaments.find((x) => x.id === m.tournamentId);
                const map = maps.find((x) => x.id === m.mapId);
                return (
                  <tr key={m.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                    <td className="text-mono px-3 py-2 text-xs text-muted-foreground">{m.id}</td>
                    <td className="px-3 py-2 font-semibold">{m.name}</td>
                    <td className="px-3 py-2 text-xs">{t?.name}</td>
                    <td className="px-3 py-2 text-xs">{map?.name}</td>
                    <td className="text-mono px-3 py-2 text-right text-xs tabular-nums">
                      {Math.floor(m.durationSec / 60)}:{(m.durationSec % 60).toString().padStart(2, "0")}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      <button className="rounded-sm border border-border bg-surface px-2 py-1 hover:bg-muted">Open</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
