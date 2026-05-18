import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { maps as seed, type ApexMap } from "@/lib/mock-match";
import { useAdminStore } from "@/lib/admin-store";

export const Route = createFileRoute("/admin/maps")({ component: MapsAdmin });

function MapsAdmin() {
  const { matches } = useAdminStore();
  const [rows] = useState<ApexMap[]>(seed);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/admin/maps" && pathname !== "/admin/maps/") {
    return <Outlet />;
  }
  const q = query.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <h1 className="text-sm font-bold uppercase tracking-wider">Maps</h1>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search maps…"
          className="w-64 rounded-sm border border-border bg-background px-2 py-1.5 text-xs"
        />
      </header>
      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((mp) => {
            const playedIn = matches.filter((m) => (m.mapIds ?? [m.mapId]).includes(mp.id)).length;
            return (
              <button
                key={mp.id}
                onClick={() => navigate({ to: "/admin/maps/$mapId" as "/admin/maps", params: { mapId: mp.id } as never })}
                className="hud-panel group overflow-hidden text-left transition hover:border-primary/50"
              >
                <div className="aspect-video w-full overflow-hidden bg-surface-2">
                  <img src={mp.image} alt={mp.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                </div>
                <div className="flex items-center justify-between border-t border-border px-3 py-2">
                  <div className="text-xs font-semibold">{mp.name}</div>
                  <div className="text-mono text-xs text-muted-foreground">{playedIn} games</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}