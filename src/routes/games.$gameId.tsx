import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { MatchViewer } from "@/components/MatchViewer";
import { MTestDataIO } from "@/components/MTestDataIO";
import { matches, parseGameId, matchSeedExtras, getGames } from "@/lib/mock-match";

export const Route = createFileRoute("/games/$gameId")({
  component: GamePage,
  notFoundComponent: () => (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-background text-foreground">
      <h1 className="text-lg font-bold">Game not found</h1>
      <Link to="/" className="text-xs text-primary hover:underline">← Back to hub</Link>
    </div>
  ),
  loader: ({ params }) => {
    const parsed = parseGameId(params.gameId);
    if (!parsed) throw notFound();
    const m = matches.find((x) => x.id === parsed.matchId);
    if (!m) throw notFound();
    const extras = matchSeedExtras[m.id];
    const games = getGames({ ...m, mapIds: extras?.mapIds, gameDurations: extras?.gameDurations });
    if (parsed.index < 0 || parsed.index >= games.length) throw notFound();
    return null;
  },
});

function GamePage() {
  const { gameId } = Route.useParams();
  return (
    <>
      <MatchViewer initialGameId={gameId} />
      {gameId === "m-test-g1" && <MTestDataIO />}
    </>
  );
}