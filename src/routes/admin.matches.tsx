import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { matches as seed, tournaments, maps, type Match } from "@/lib/mock-match";
import { CrudTable, type ColumnDef } from "@/components/admin/CrudTable";

export const Route = createFileRoute("/admin/matches")({ component: MatchesAdmin });

const columns: ColumnDef<Match>[] = [
  { key: "id", label: "ID", width: "120px" },
  { key: "name", label: "Match" },
  {
    key: "tournamentId",
    label: "Tournament",
    type: "select",
    options: tournaments.map((t) => ({ value: t.id, label: t.name })),
    render: (m) => tournaments.find((t) => t.id === m.tournamentId)?.name ?? m.tournamentId,
  },
  {
    key: "mapId",
    label: "Map",
    type: "select",
    options: maps.map((m) => ({ value: m.id, label: m.name })),
    render: (m) => maps.find((x) => x.id === m.mapId)?.name ?? m.mapId,
  },
  {
    key: "durationSec",
    label: "Duration",
    type: "number",
    align: "right",
    width: "110px",
    render: (m) => `${Math.floor(m.durationSec / 60)}:${(m.durationSec % 60).toString().padStart(2, "0")}`,
  },
];

function MatchesAdmin() {
  const [rows, setRows] = useState<Match[]>(seed);
  return (
    <CrudTable
      title="Matches"
      rows={rows}
      columns={columns}
      createEmpty={() => ({
        id: `m-${Date.now()}`,
        name: "",
        tournamentId: tournaments[0]?.id ?? "",
        mapId: maps[0]?.id ?? "",
        durationSec: 1200,
      })}
      onChange={setRows}
    />
  );
}
