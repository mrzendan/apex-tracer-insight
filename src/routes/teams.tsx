import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { teams } from "@/lib/mock-match";
import { TeamLogo } from "@/components/admin/TeamLogo";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/teams")({
  component: TeamsPage,
  head: () => ({
    meta: [
      { title: "Команды — APEX STATS" },
      { name: "description", content: "Все команды и их статистика в Apex Legends." },
    ],
  }),
});

type Status = "active" | "inactive";

function TeamsPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/teams" && pathname !== "/teams/") return <Outlet />;
  return <TeamsList />;
}

function TeamsList() {
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [query, setQuery] = useState("");

  const enriched = useMemo(() => teams.map((t) => ({
    t, status: (t.alive ? "active" : "inactive") as Status,
  })), []);

  const q = query.trim().toLowerCase();
  const searched = q
    ? enriched.filter(({ t }) => t.name.toLowerCase().includes(q) || t.tag.toLowerCase().includes(q))
    : enriched;

  const counts = {
    all: searched.length,
    active: searched.filter((x) => x.status === "active").length,
    inactive: searched.filter((x) => x.status === "inactive").length,
  };
  const filtered = filter === "all" ? searched : searched.filter((x) => x.status === filter);

  const groups: { key: Status; label: string }[] = [
    { key: "active", label: "Активные" },
    { key: "inactive", label: "Неактивные" },
  ];
  const visibleGroups = filter === "all" ? groups : groups.filter((g) => g.key === filter);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-surface/80 px-4 backdrop-blur">
        <BrandMark subtitle="Команды" />
        <div className="ml-auto flex items-center gap-2">
        </div>
      </header>
      <div className="mx-auto max-w-7xl p-6">
        <div className="mb-4 flex items-center gap-3">
          <Link to="/" aria-label="Назад" className="flex h-8 w-8 items-center justify-center rounded-sm border border-border-strong bg-surface-2 text-sm hover:bg-muted">←</Link>
          <h1 className="text-xl font-bold">Команды</h1>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {([
            { key: "all", label: "Все" },
            { key: "active", label: "Активные" },
            { key: "inactive", label: "Неактивные" },
          ] as const).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-sm border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition ${
                filter === f.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border-strong bg-surface-2 hover:bg-muted"
              }`}
            >
              {f.label} <span className="opacity-60">· {counts[f.key]}</span>
            </button>
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск команды…"
            className="ml-2 w-56 rounded-sm border border-border bg-background px-2 py-1.5 text-xs"
          />
        </div>

        {visibleGroups.map((g) => {
          const items = filtered.filter((x) => x.status === g.key)
            .sort((a, b) => a.t.placement - b.t.placement);
          if (items.length === 0) return null;
          return (
            <section key={g.key} className="mb-6">
              <div className="mb-2 flex items-center gap-2 border-b border-border pb-1.5">
                <StatusDot status={g.key} />
                <h2 className="text-sm font-bold uppercase tracking-wider">{g.label}</h2>
                <span className="text-mono text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {items.map(({ t, status }) => (
                  <Link key={t.id} to="/teams/$teamId" params={{ teamId: t.id }}
                    className="hud-panel flex items-center gap-2.5 px-3 py-2 transition hover:border-primary/40">
                    <TeamLogo team={t} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold">{t.name}</div>
                      <div className="text-mono text-xs text-muted-foreground">{t.tag} · #{t.placement}</div>
                    </div>
                    <StatusBadge status={status} />
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
        {filtered.length === 0 && (
          <div className="hud-panel p-6 text-center text-xs text-muted-foreground">Нет команд с таким статусом</div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map = {
    active:   { label: "ACTIVE",   cls: "border-success/40 bg-success/15 text-success" },
    inactive: { label: "INACTIVE", cls: "border-border bg-surface-2 text-muted-foreground" },
  } as const;
  const m = map[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-bold tracking-wider ${m.cls}`}>
      {status === "active" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />}
      {m.label}
    </span>
  );
}

function StatusDot({ status }: { status: Status }) {
  const cls = status === "active" ? "bg-success" : "bg-muted-foreground";
  return <span className={`h-2 w-2 rounded-full ${cls}`} />;
}
