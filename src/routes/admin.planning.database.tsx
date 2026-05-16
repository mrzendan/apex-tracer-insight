import { createFileRoute } from "@tanstack/react-router";
import { DiagramEditor } from "@/components/planning/DiagramEditor";

export const Route = createFileRoute("/admin/planning/database")({ component: DatabasePage });

function DatabasePage() {
  return <DiagramEditor kind="database" title="Database schema" />;
}