import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { tournaments as seed, type Tournament } from "@/lib/mock-match";
import { CrudTable, type ColumnDef } from "@/components/admin/CrudTable";

export const Route = createFileRoute("/admin/tournaments")({ component: TournamentsAdmin });

const columns: ColumnDef<Tournament>[] = [
  { key: "id", label: "ID", width: "200px" },
  { key: "name", label: "Name" },
];

function TournamentsAdmin() {
  const [rows, setRows] = useState<Tournament[]>(seed);
  return (
    <CrudTable
      title="Tournaments"
      rows={rows}
      columns={columns}
      createEmpty={() => ({ id: `t-${Date.now()}`, name: "" })}
      onChange={setRows}
    />
  );
}