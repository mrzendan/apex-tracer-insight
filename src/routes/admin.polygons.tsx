import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/polygons")({ component: PolygonsAdmin });

function PolygonsAdmin() {
  return <Stub title="Polygons" desc="Draw forbidden / safe areas directly on the full map. Coming next." />;
}

function Stub({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-surface px-6">
        <h1 className="text-sm font-bold uppercase tracking-wider">{title}</h1>
      </header>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="hud-panel max-w-md p-6 text-center">
          <div className="label-eyebrow mb-2">Tool</div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="mt-2 text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
    </div>
  );
}
