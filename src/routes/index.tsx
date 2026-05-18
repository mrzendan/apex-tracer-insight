import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { tournaments, matches, maps, teams, type Match } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";
import { RouteGuard } from "@/components/auth/RouteGuard";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DensityToggle } from "@/components/DensityToggle";
import { HubClassic } from "@/components/hub/HubClassic";
import {
  Trophy, Swords, MapIcon as MapMarker, Users, ArrowRight, Activity,
  CheckCircle2, Loader2, AlertTriangle, CircleSlash, Play, Sparkles,
} from "lucide-react";

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

/* ----------------------------- processing model ---------------------------- */

type PipelineState = "ready" | "processing" | "error" | "missing";
type MatchProcessing = {
  trajectory: PipelineState;
  rings: PipelineState;
  events: PipelineState;
  /** Aggregate. */
  overall: PipelineState;
  /** Human-readable "last analyzed" hint. */
  analyzedHint: string;
};

/** Deterministic mock status from match id — replace with real metadata later. */
function processingFor(m: Match): MatchProcessing {
  const seed = m.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const variants: Array<Pick<MatchProcessing, "trajectory" | "rings" | "events">> = [
    { trajectory: "ready", rings: "ready", events: "ready" },
    { trajectory: "ready", rings: "ready", events: "ready" },
    { trajectory: "ready", rings: "ready", events: "processing" },
    { trajectory: "ready", rings: "processing", events: "missing" },
    { trajectory: "processing", rings: "processing", events: "missing" },
    { trajectory: "ready", rings: "ready", events: "error" },
  ];
  const v = variants[seed % variants.length];
  const states = [v.trajectory, v.rings, v.events];
  const overall: PipelineState =
    states.every((s) => s === "ready") ? "ready"
    : states.some((s) => s === "error") ? "error"
    : states.some((s) => s === "processing") ? "processing"
    : "missing";
  const hints = ["сегодня", "вчера", "2 дня назад", "на этой неделе", "—", "ошибка пайплайна"];
  const analyzedHint = overall === "error" ? "ошибка пайплайна"
    : overall === "missing" ? "—"
    : hints[seed % 4];
  return { ...v, overall, analyzedHint };
}

const STATE_META: Record<PipelineState, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ready:      { label: "Готово",      cls: "text-success",        Icon: CheckCircle2 },
  processing: { label: "Обработка",   cls: "text-cyan",           Icon: Loader2 },
  error:      { label: "Ошибка",      cls: "text-destructive",    Icon: AlertTriangle },
  missing:    { label: "Нет данных",  cls: "text-muted-foreground", Icon: CircleSlash },
};

function StatusChip({ state, label }: { state: PipelineState; label: string }) {
  const m = STATE_META[state];
  return (
    <span className="text-mono inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2/70 px-1.5 py-0.5 text-[10px]">
      <m.Icon className={`h-3 w-3 ${m.cls} ${state === "processing" ? "animate-spin" : ""}`} strokeWidth={2.5} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function OverallBadge({ state }: { state: PipelineState }) {
  const m = STATE_META[state];
  const bg =
    state === "ready" ? "bg-success/15 border-success/40 text-success"
    : state === "processing" ? "bg-cyan/15 border-cyan/40 text-cyan"
    : state === "error" ? "bg-destructive/15 border-destructive/40 text-destructive"
    : "bg-surface-2 border-border text-muted-foreground";
  return (
    <span className={`text-mono inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${bg}`}>
      <m.Icon className={`h-3 w-3 ${state === "processing" ? "animate-spin" : ""}`} strokeWidth={2.5} />
      {m.label}
    </span>
  );
}

/* ---------------------------------- page ---------------------------------- */

function Hub() {
  const { role, user, signOut } = useAuth();

  const stats = useMemo(() => ({
    tournaments: tournaments.length,
    matches: matches.length,
    maps: maps.length,
    teams: teams.length,
  }), []);

  // Featured = the most recent ready (or any) match; rest in the grid.
  const featured = useMemo(() => {
    const ready = matches.find((m) => processingFor(m).overall === "ready");
    return ready ?? matches[0];
  }, []);
  const recentMatches = useMemo(
    () => matches.filter((m) => m.id !== featured?.id).slice(0, 4),
    [featured],
  );
  const topTeams = useMemo(() => [...teams].sort((a, b) => a.placement - b.placement).slice(0, 8), []);

  const liveTeamIds = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const liveTournamentIds = new Set(
      tournaments.filter((t) => t.startDate <= today && today <= t.endDate).map((t) => t.id),
    );
    const ids = new Set<string>();
    for (const m of matches as Array<{ tournamentId: string; teamIds?: string[] }>) {
      if (!liveTournamentIds.has(m.tournamentId)) continue;
      const tids = m.teamIds ?? teams.map((t) => t.id);
      for (const id of tids) ids.add(id);
    }
    return ids;
  }, []);

  // Tournament-level rollups
  const tournamentStats = useMemo(() => {
    return tournaments.map((t) => {
      const tMatches = matches.filter((m) => m.tournamentId === t.id);
      const procs = tMatches.map((m) => processingFor(m));
      const ready = procs.filter((p) => p.overall === "ready").length;
      const mapIds = new Set(tMatches.map((m) => m.mapId));
      const lastReady = tMatches.find((m, i) => procs[i].overall === "ready");
      return {
        tournament: t,
        tMatches,
        ready,
        total: tMatches.length,
        mapsCount: mapIds.size,
        teamsCount: 20, // mock — full lobby
        lastAnalyzedHint: lastReady ? processingFor(lastReady).analyzedHint : "—",
        openMatch: lastReady ?? tMatches[0],
      };
    });
  }, []);

  const featuredProc = featured ? processingFor(featured) : null;
  const featuredMap = featured ? maps.find((x) => x.id === featured.mapId) : null;
  const featuredTournament = featured ? tournaments.find((t) => t.id === featured.tournamentId) : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Aurora background */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden opacity-60">
        <div className="absolute -left-32 -top-32 h-[480px] w-[480px] rounded-full blur-[120px]"
          style={{ background: "var(--color-primary)", opacity: 0.18, animation: "blob-drift 18s ease-in-out infinite" }} />
        <div className="absolute -right-24 top-1/3 h-[420px] w-[420px] rounded-full blur-[120px]"
          style={{ background: "var(--color-cyan)", opacity: 0.12, animation: "blob-drift 22s ease-in-out infinite reverse" }} />
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
          <DensityToggle compact />
          <span className="text-mono hidden text-[10px] text-muted-foreground sm:inline">
            {user?.email} · {role}
          </span>
          <Link to="/maps" className="rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-muted">
            Карты
          </Link>
          {(role === "operator" || role === "administrator") && (
            <Link to="/admin" className="rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-muted">
              Admin
            </Link>
          )}
          <button onClick={() => signOut()} className="rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-muted">
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 pb-16 pt-8">
        {/* Compact hero */}
        <section className="animate-fade-in">
          <div className="label-eyebrow text-[11px] text-primary">VOD analytics platform</div>
          <h1 className="mt-2 max-w-3xl text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
            Превращай матчи Apex Legends <span className="text-primary">в инсайты команды.</span>
          </h1>

          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatPill label="Турниры"   value={stats.tournaments} Icon={Trophy} />
            <StatPill label="Матчи"     value={stats.matches}     Icon={Swords} />
            <StatPill label="Карты"     value={stats.maps}        Icon={MapMarker} />
            <StatPill label="Команды"   value={stats.teams}       Icon={Users} />
          </div>
        </section>

        {/* Featured: last analysis */}
        {featured && featuredProc && (
          <section className="mt-8 animate-slide-up">
            <SectionHead
              title="Продолжить анализ"
              subtitle="Последний матч, готовый к просмотру"
              badge={<><Sparkles className="h-3 w-3" /> featured</>}
            />
            <Link
              to="/matches/$matchId"
              params={{ matchId: featured.id }}
              className="hud-panel-strong hover-lift group mt-4 grid overflow-hidden md:grid-cols-[1.2fr_1fr]"
            >
              <div className="relative h-48 overflow-hidden md:h-full md:min-h-[220px]">
                {featuredMap?.image && (
                  <img src={featuredMap.image} alt={featuredMap.name}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface/30 to-transparent md:bg-gradient-to-r" />
                <div className="absolute left-3 top-3">
                  <OverallBadge state={featuredProc.overall} />
                </div>
              </div>
              <div className="flex flex-col justify-between gap-4 p-5">
                <div>
                  <div className="label-eyebrow text-[10px] text-muted-foreground">
                    {featuredTournament?.name} · {featuredTournament?.region}
                  </div>
                  <h3 className="mt-1.5 text-2xl font-bold leading-tight">{featured.name}</h3>
                  <div className="text-mono mt-1 text-[11px] text-muted-foreground">
                    {featuredMap?.name} · {Math.round(featured.durationSec / 60)} мин · анализ: {featuredProc.analyzedHint}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <StatusChip state={featuredProc.trajectory} label="траектории" />
                    <StatusChip state={featuredProc.rings} label="кольца" />
                    <StatusChip state={featuredProc.events} label="события" />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Готов к просмотру
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-sm bg-primary px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-transform group-hover:translate-x-0.5">
                    <Play className="h-3.5 w-3.5" strokeWidth={2.5} />
                    Открыть карту
                  </span>
                </div>
              </div>
            </Link>
          </section>
        )}

        {/* Recent matches — moved up */}
        <section className="mt-10 animate-slide-up" style={{ animationDelay: "60ms" }}>
          <SectionHead title="Последние матчи" subtitle="Готовы к просмотру и анализу" badge={<><Activity className="h-3 w-3" /> {matches.length}</>} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {recentMatches.map((m, i) => {
              const mp = maps.find((x) => x.id === m.mapId);
              const t = tournaments.find((x) => x.id === m.tournamentId);
              const proc = processingFor(m);
              return (
                <Link key={m.id} to="/matches/$matchId" params={{ matchId: m.id }}
                  className="hud-panel hover-lift group relative overflow-hidden animate-fade-in"
                  style={{ animationDelay: `${80 + i * 50}ms` }}
                >
                  {mp?.image && (
                    <div className="relative h-28 overflow-hidden">
                      <img src={mp.image} alt={mp.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                      <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />
                      <div className="absolute right-2 top-2"><OverallBadge state={proc.overall} /></div>
                    </div>
                  )}
                  <div className="p-3">
                    <div className="label-eyebrow text-[9px] text-muted-foreground truncate">{t?.name}</div>
                    <div className="mt-1 text-sm font-semibold leading-tight">{m.name}</div>
                    <div className="text-mono mt-1 text-[10px] text-muted-foreground">
                      {mp?.name} · {Math.round(m.durationSec / 60)} мин
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <StatusChip state={proc.trajectory} label="трек" />
                      <StatusChip state={proc.rings} label="кольца" />
                      <StatusChip state={proc.events} label="события" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Tournaments — with progress */}
        <section className="mt-12 animate-slide-up" style={{ animationDelay: "120ms" }}>
          <SectionHead title="Турниры" subtitle="Прогресс обработки и быстрый вход" badge={`${tournaments.length} активных`} />
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tournamentStats.map(({ tournament: t, tMatches, ready, total, mapsCount, teamsCount, lastAnalyzedHint, openMatch }, i) => {
              const pct = total === 0 ? 0 : Math.round((ready / total) * 100);
              return (
                <div key={t.id}
                  className="hud-panel-strong hover-lift group relative flex flex-col overflow-hidden p-5 animate-fade-in"
                  style={{ animationDelay: `${140 + i * 50}ms` }}
                >
                  <div className="absolute right-0 top-0 h-24 w-24 -translate-y-8 translate-x-8 rounded-full bg-primary/10 blur-2xl opacity-60" />
                  <div className="flex items-center justify-between">
                    <span className="label-eyebrow text-[10px] text-primary">{t.region} · {t.type}</span>
                    <span className="text-mono rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">Y{t.year}</span>
                  </div>
                  <h3 className="mt-2 text-lg font-bold leading-tight">{t.name}</h3>
                  <div className="text-mono mt-1 text-[10px] text-muted-foreground">
                    {t.startDate} → {t.endDate}
                  </div>

                  {/* Progress */}
                  <div className="mt-4">
                    <div className="flex items-baseline justify-between">
                      <span className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Обработано матчей
                      </span>
                      <span className="text-mono text-xs font-bold tabular-nums">
                        {ready} / {total}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {/* Mini stats */}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <MiniStat label="команд"  value={teamsCount} />
                    <MiniStat label="карт"    value={mapsCount} />
                    <MiniStat label="анализ"  value={lastAnalyzedHint} mono={false} />
                  </div>

                  {/* Match list */}
                  <ul className="mt-3 space-y-1.5">
                    {tMatches.slice(0, 3).map((m) => {
                      const mp = maps.find((x) => x.id === m.mapId);
                      const proc = processingFor(m);
                      return (
                        <li key={m.id}>
                          <Link to="/matches/$matchId" params={{ matchId: m.id }}
                            className="group/match flex items-center justify-between gap-2 rounded-sm border border-border bg-surface/60 px-2.5 py-1.5 text-xs transition-all hover:border-primary/50 hover:bg-surface-2"
                          >
                            <span className="flex min-w-0 items-center gap-2 font-semibold">
                              {mp?.image && (
                                <img src={mp.image} alt="" className="h-6 w-6 shrink-0 rounded-sm object-cover ring-1 ring-border" />
                              )}
                              <span className="truncate">{m.name}</span>
                            </span>
                            <OverallBadge state={proc.overall} />
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

                  {/* CTA */}
                  {openMatch && (
                    <Link
                      to="/matches/$matchId"
                      params={{ matchId: openMatch.id }}
                      className="mt-4 inline-flex items-center justify-center gap-2 rounded-sm border border-border-strong bg-surface-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-all hover:border-primary/50 hover:bg-primary hover:text-primary-foreground"
                    >
                      Открыть турнир
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Top teams */}
        <section className="mt-12 animate-slide-up" style={{ animationDelay: "180ms" }}>
          <SectionHead title="Топ команды" subtitle="По текущему размещению" badge={`${teams.length} команд`} />
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {topTeams.map((team, i) => (
              <Link key={team.id} to="/teams/$teamId" params={{ teamId: team.id }}
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
                {liveTeamIds.has(team.id) && (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" title="Сейчас играет" />
                )}
              </Link>
            ))}
          </div>
          <div className="mt-3 text-right">
            <a href="/?classic=1" className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary">
              Classic view →
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function MiniStat({ label, value, mono = true }: { label: string; value: number | string; mono?: boolean }) {
  return (
    <div className="rounded-sm border border-border bg-surface/60 px-2 py-1.5">
      <div className={`${mono ? "text-mono tabular-nums" : ""} text-xs font-bold leading-none`}>{value}</div>
      <div className="label-eyebrow mt-1 text-[9px]">{label}</div>
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
