import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { tournaments, matches, maps, teams } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";
import { RouteGuard } from "@/components/auth/RouteGuard";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HubClassic } from "@/components/hub/HubClassic";
import { Trophy, Swords, MapIcon as MapMarker, Users, ArrowRight, Activity } from "lucide-react";

export const Route = createFileRoute("/")({
  component: () => (
    <RouteGuard min="user">
      <HubRouter />
    </RouteGuard>
  ),
  head: () => ({
    meta: [
      { title: "APEX STATS — VOD Analytics Hub" },
      { name: "description", content: "Browse Apex Legends tournaments, matches, and teams. Click a match to open the VOD analytics viewer." },
    ],
  }),
});

function HubRouter() {
  const classic = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("classic") === "1";
  return classic ? <HubClassic /> : <Hub />;
}

function Hub() {
  const { role, user, signOut } = useAuth();

  const stats = useMemo(() => ({
    tournaments: tournaments.length,
    matches: matches.length,
    maps: maps.length,
    teams: teams.length,
  }), []);

  const recentMatches = matches.slice(0, 4);
  const topTeams = useMemo(() => [...teams].sort((a, b) => a.placement - b.placement).slice(0, 8), []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Aurora background */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden opacity-60">
        <div
          className="absolute -left-32 -top-32 h-[480px] w-[480px] rounded-full blur-[120px]"
          style={{ background: "var(--color-primary)", opacity: 0.18, animation: "blob-drift 18s ease-in-out infinite" }}
        />
        <div
          className="absolute -right-24 top-1/3 h-[420px] w-[420px] rounded-full blur-[120px]"
          style={{ background: "var(--color-cyan)", opacity: 0.12, animation: "blob-drift 22s ease-in-out infinite reverse" }}
        />
      </div>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-surface/80 px-4 backdrop-blur">
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
          <ThemeToggle compact />
          <span className="text-mono hidden text-[10px] text-muted-foreground sm:inline">
            {user?.email} · {role}
          </span>
          {(role === "operator" || role === "administrator") && (
            <Link
              to="/admin"
              className="rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-muted"
            >
              Admin
            </Link>
          )}
          <button
            onClick={() => signOut()}
            className="rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-muted"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 pb-16 pt-10">
        {/* Hero */}
        <section className="animate-fade-in">
          <div className="label-eyebrow text-[11px] text-primary">VOD analytics platform</div>
          <h1 className="mt-3 max-w-4xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Превращай матчи Apex Legends
            <br />
            <span className="text-primary">в инсайты команды.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Анализ VOD, трекинг позиций, разбор зон и таймингов — всё в одном интерфейсе для тренеров и аналитиков.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatPill label="Турниры"   value={stats.tournaments} Icon={Trophy} />
            <StatPill label="Матчи"     value={stats.matches}     Icon={Swords} />
            <StatPill label="Карты"     value={stats.maps}        Icon={MapMarker} />
            <StatPill label="Команды"   value={stats.teams}       Icon={Users} />
          </div>
        </section>

        {/* Tournaments */}
        <section className="mt-12 animate-slide-up" style={{ animationDelay: "60ms" }}>
          <SectionHead title="Турниры" subtitle="Активные кампании и архив сезонов" badge={`${tournaments.length} активных`} />
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((t, i) => {
              const tMatches = matches.filter((m) => m.tournamentId === t.id);
              return (
                <div
                  key={t.id}
                  className="hud-panel-strong hover-lift group relative overflow-hidden p-5 animate-fade-in"
                  style={{ animationDelay: `${80 + i * 50}ms` }}
                >
                  <div className="absolute right-0 top-0 h-24 w-24 -translate-y-8 translate-x-8 rounded-full bg-primary/10 blur-2xl transition-opacity group-hover:opacity-100 opacity-60" />
                  <div className="flex items-center justify-between">
                    <span className="label-eyebrow text-[10px] text-primary">{t.region} · {t.type}</span>
                    <span className="text-mono rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      Y{t.year}
                    </span>
                  </div>
                  <h3 className="mt-2 text-lg font-bold leading-tight">{t.name}</h3>
                  <div className="text-mono mt-1 text-[10px] text-muted-foreground">
                    {t.startDate} → {t.endDate}
                  </div>

                  <ul className="mt-4 space-y-1.5">
                    {tMatches.slice(0, 3).map((m) => {
                      const mp = maps.find((x) => x.id === m.mapId);
                      return (
                        <li key={m.id}>
                          <Link
                            to="/matches/$matchId"
                            params={{ matchId: m.id }}
                            className="group/match flex items-center justify-between rounded-sm border border-border bg-surface/60 px-2.5 py-2 text-xs transition-all hover:border-primary/50 hover:bg-surface-2"
                          >
                            <span className="flex items-center gap-2 font-semibold">
                              {mp?.image && (
                                <img src={mp.image} alt="" className="h-6 w-6 rounded-sm object-cover ring-1 ring-border" />
                              )}
                              {m.name}
                            </span>
                            <ArrowRight className="h-3 w-3 -translate-x-1 opacity-0 transition-all group-hover/match:translate-x-0 group-hover/match:opacity-100" />
                          </Link>
                        </li>
                      );
                    })}
                    {tMatches.length > 3 && (
                      <li className="text-mono px-2.5 text-[10px] text-muted-foreground">
                        +{tMatches.length - 3} ещё
                      </li>
                    )}
                    {tMatches.length === 0 && (
                      <li className="text-[11px] text-muted-foreground">Матчей пока нет</li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {/* Recent matches */}
        <section className="mt-12 animate-slide-up" style={{ animationDelay: "120ms" }}>
          <SectionHead title="Последние матчи" subtitle="Готовы к просмотру и анализу" badge={<Activity className="h-3 w-3" />} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {recentMatches.map((m, i) => {
              const mp = maps.find((x) => x.id === m.mapId);
              const t = tournaments.find((x) => x.id === m.tournamentId);
              return (
                <Link
                  key={m.id}
                  to="/matches/$matchId"
                  params={{ matchId: m.id }}
                  className="hud-panel hover-lift group relative overflow-hidden animate-fade-in"
                  style={{ animationDelay: `${140 + i * 50}ms` }}
                >
                  {mp?.image && (
                    <div className="relative h-28 overflow-hidden">
                      <img src={mp.image} alt={mp.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                      <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="label-eyebrow text-[9px] text-muted-foreground truncate">{t?.name}</div>
                    <div className="mt-1 text-sm font-semibold leading-tight">{m.name}</div>
                    <div className="text-mono mt-1 text-[10px] text-muted-foreground">
                      {mp?.name} · {Math.round(m.durationSec / 60)} мин
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Top teams */}
        <section className="mt-12 animate-slide-up" style={{ animationDelay: "180ms" }}>
          <SectionHead title="Топ команды" subtitle="По текущему размещению" badge={`${teams.length} команд`} />
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {topTeams.map((team, i) => (
              <Link
                key={team.id}
                to="/teams/$teamId"
                params={{ teamId: team.id }}
                className="hud-panel hover-lift flex items-center gap-3 px-3 py-2.5 animate-fade-in"
                style={{ animationDelay: `${200 + i * 30}ms` }}
              >
                <TeamLogo team={team} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{team.name}</div>
                  <div className="text-mono text-[10px] text-muted-foreground">
                    {team.tag} · #{team.placement} · {team.kills}K
                  </div>
                </div>
                {team.alive && (
                  <span className="h-1.5 w-1.5 rounded-full bg-success" title="Жива" />
                )}
              </Link>
            ))}
          </div>
          <div className="mt-3 text-right">
            <a
              href="/?classic=1"
              className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary"
            >
              Classic view →
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatPill({ label, value, Icon }: { label: string; value: number; Icon: typeof Trophy }) {
  return (
    <div className="hud-panel-strong hover-lift flex items-center gap-3 px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary/15 text-primary">
        <Icon className="h-4 w-4" strokeWidth={2} />
      </div>
      <div>
        <div className="label-eyebrow text-[9px]">{label}</div>
        <div className="text-mono mt-0.5 text-xl font-bold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

function SectionHead({ title, subtitle, badge }: { title: string; subtitle?: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {badge && (
        <span className="text-mono inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          {badge}
        </span>
      )}
    </div>
  );
}
