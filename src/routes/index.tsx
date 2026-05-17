import { createFileRoute, Link } from "@tanstack/react-router";
import { tournaments, matches, maps, teams } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";
import { RouteGuard } from "@/components/auth/RouteGuard";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: () => (
    <RouteGuard min="user">
      <Hub />
    </RouteGuard>
  ),
  head: () => ({
    meta: [
      { title: "APEX STATS — VOD Analytics Hub" },
      { name: "description", content: "Browse Apex Legends tournaments, matches, and teams. Click a match to open the VOD analytics viewer." },
    ],
  }),
});

function Hub() {
  const { role, user, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center gap-4 border-b border-border bg-surface px-4">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M12 3 L21 20 H3 Z" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight">APEX STATS</div>
            <div className="label-eyebrow text-[9px]">VOD analytics</div>
          </div>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-mono hidden sm:inline text-[10px] text-muted-foreground">
            {user?.email} · {role}
          </span>
          {(role === "operator" || role === "administrator") && (
            <Link to="/admin" className="rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider hover:bg-muted">
              Admin
            </Link>
          )}
          <button
            onClick={() => signOut()}
            className="rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider hover:bg-muted"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-8 p-6">
        <section>
          <div className="mb-3 flex items-end justify-between">
            <h1 className="text-xl font-bold">Tournaments</h1>
            <span className="text-mono text-[10px] text-muted-foreground">{tournaments.length} total</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((t) => {
              const tMatches = matches.filter((m) => m.tournamentId === t.id);
              return (
                <div key={t.id} className="hud-panel p-4">
                  <div className="label-eyebrow text-[10px]">{t.region} · {t.type}</div>
                  <div className="mt-1 text-sm font-semibold">{t.name}</div>
                  <div className="text-mono mt-0.5 text-[10px] text-muted-foreground">{t.startDate} → {t.endDate}</div>
                  <ul className="mt-3 space-y-1">
                    {tMatches.map((m) => {
                      const mp = maps.find((x) => x.id === m.mapId);
                      return (
                        <li key={m.id}>
                          <Link
                            to="/matches/$matchId"
                            params={{ matchId: m.id }}
                            className="flex items-center justify-between rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-xs hover:border-primary/40 hover:text-primary"
                          >
                            <span className="font-semibold">{m.name}</span>
                            <span className="text-muted-foreground">{mp?.name}</span>
                          </Link>
                        </li>
                      );
                    })}
                    {tMatches.length === 0 && (
                      <li className="text-[10px] text-muted-foreground">No matches yet</li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-xl font-bold">Teams</h2>
            <span className="text-mono text-[10px] text-muted-foreground">{teams.length} total</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {[...teams].sort((a, b) => a.placement - b.placement).map((team) => (
              <Link
                key={team.id}
                to="/teams/$teamId"
                params={{ teamId: team.id }}
                className="hud-panel flex items-center gap-2.5 px-3 py-2 transition hover:border-primary/40"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: team.color }} />
                <TeamLogo team={team} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{team.name}</div>
                  <div className="text-mono text-[10px] text-muted-foreground">{team.tag} · #{team.placement}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
