import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { teams as seed, type Team } from "@/lib/mock-match";
import { CrudTable, type ColumnDef } from "@/components/admin/CrudTable";

export const Route = createFileRoute("/admin/teams")({ component: TeamsAdmin });

const columns: ColumnDef<Team>[] = [
  { key: "tag", label: "Tag", width: "70px" },
  { key: "name", label: "Name" },
  { key: "color", label: "Color", type: "color", width: "160px" },
  { key: "players", label: "Players", type: "list" },
  { key: "placement", label: "Place", type: "number", width: "70px", align: "right" },
  { key: "kills", label: "Kills", type: "number", width: "70px", align: "right" },
];

function TeamsAdmin() {
  const [rows, setRows] = useState<Team[]>(seed);
  return (
    <CrudTable
      title="Teams"
      rows={rows}
      columns={columns}
      createEmpty={() => ({
        id: `team-${Date.now()}`,
        tag: "",
        name: "",
        color: "#ffffff",
        players: [],
        placement: rows.length + 1,
        kills: 0,
        alive: true,
      })}
      onChange={setRows}
    />
  );
}