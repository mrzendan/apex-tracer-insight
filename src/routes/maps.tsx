import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { maps as seed, type ApexMap } from "@/lib/mock-match";
import { useAdminStore } from "@/lib/admin-store";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/maps")({
  component: MapsPage,
  head: () => ({
    meta: [
      { title: "Карты — APEX STATS" },
      { name: "description", content: "Все карты Apex Legends и тепловые карты команд по матчам." },
    ],
  }),
});

function MapsPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/maps" && pathname !== "/maps/") return <Outlet />;
  return <MapsGrid />;
}

function MapsGrid() {
  const { matches } = useAdminStore();
  const [rows] = useState<ApexMap[]>(seed);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const q = query.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-surface/80 px-4 backdrop-blur">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M12 3 L21 20 H3 Z" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight">APEX STATS</div>
            <div className="label-eyebrow text-[9px]">Карты</div>
          </div>
        </Link>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск карты…"
          className="ml-4 w-64 rounded-sm border border-border bg-background px-2 py-1.5 text-xs"
        />
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle compact />
          <Link to="/" className="rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider hover:bg-muted">
            ← На главную
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-6">
        <h1 className="mb-4 text-xl font-bold">Карты</h1>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((mp) => {
            const playedIn = matches.filter((m) => (m.mapIds ?? [m.mapId]).includes(mp.id)).length;
            return (
              <button
                key={mp.id}
                onClick={() => navigate({ to: "/maps/$mapId", params: { mapId: mp.id } })}
                className="hud-panel group overflow-hidden text-left transition hover:border-primary/50"
              >
                <div className="aspect-video w-full overflow-hidden bg-surface-2">
                  <img src={mp.image} alt={mp.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                </div>
                <div className="flex items-center justify-between border-t border-border px-3 py-2">
                  <div className="text-xs font-semibold">{mp.name}</div>
                  <div className="text-mono text-[10px] text-muted-foreground">{playedIn} матчей</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}