import { createFileRoute } from "@tanstack/react-router";
import { DiagramEditor } from "@/components/planning/DiagramEditor";

export const Route = createFileRoute("/admin/planning/architecture")({ component: ArchitecturePage });

function ArchitecturePage() {
  return <DiagramEditor kind="architecture" title="Project architecture" />;
}