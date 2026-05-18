import { createFileRoute, Link } from "@tanstack/react-router";
import { MapDetailContent } from "@/components/maps/MapDetailContent";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/maps/$mapId")({
  component: MapDetailPage,
  validateSearch: (s: Record<string, unknown>) => ({ team: typeof s.team === "string" ? s.team : undefined }),
});

function MapDetailPage() {
  const { mapId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur">
        <Link to="/" className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground">APEX STATS</Link>
        <span className="text-mono text-[10px] text-muted-foreground">/</span>
        <Link to="/maps" className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground">Карты</Link>
        <div className="ml-auto"><ThemeToggle compact /></div>
      </header>
      <div className="min-h-0 flex-1">
        <MapDetailContent mapId={mapId} initialTeam={search.team} backTo="/maps" backLabel="Карты" />
      </div>
    </div>
  );
}