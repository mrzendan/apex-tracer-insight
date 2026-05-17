import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { MatchViewer } from "@/components/MatchViewer";
import { matches } from "@/lib/mock-match";

export const Route = createFileRoute("/matches/$matchId")({
  component: MatchPage,
  notFoundComponent: () => (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-background text-foreground">
      <h1 className="text-lg font-bold">Match not found</h1>
      <Link to="/" className="text-xs text-primary hover:underline">← Back to hub</Link>
    </div>
  ),
  loader: ({ params }) => {
    const m = matches.find((x) => x.id === params.matchId);
    if (!m) throw notFound();
    return m;
  },
});

function MatchPage() {
  const { matchId } = Route.useParams();
  return <MatchViewer initialMatchId={matchId} />;
}
