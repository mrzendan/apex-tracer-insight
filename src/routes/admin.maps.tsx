import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { maps as seed, type ApexMap } from "@/lib/mock-match";
import { CrudTable, type ColumnDef } from "@/components/admin/CrudTable";

export const Route = createFileRoute("/admin/maps")({ component: MapsAdmin });

const columns: ColumnDef<ApexMap>[] = [
  { key: "id", label: "ID", width: "180px" },
  { key: "name", label: "Name" },
  {
    key: "image",
    label: "Preview",
    width: "120px",
    render: (m) => <img src={m.image} alt={m.name} className="h-10 w-16 rounded-sm border border-border object-cover" />,
  },
  { key: "image", label: "Image URL" },
];

function MapsAdmin() {
  const [rows, setRows] = useState<ApexMap[]>(seed);
  return (
    <CrudTable
      title="Maps"
      rows={rows}
      columns={columns}
      createEmpty={() => ({ id: `map-${Date.now()}`, name: "", image: "" })}
      onChange={setRows}
    />
  );
}