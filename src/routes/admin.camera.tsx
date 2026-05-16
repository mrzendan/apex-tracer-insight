import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/camera")({ component: CameraAdmin });

function CameraAdmin() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-surface px-6">
        <h1 className="text-sm font-bold uppercase tracking-wider">Camera tracking</h1>
      </header>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="hud-panel max-w-md p-6 text-center">
          <div className="label-eyebrow mb-2">Tool</div>
          <h2 className="text-lg font-bold">Camera tracking</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Calibrate the observer camera and reconstruct viewport position over time. Coming next.
          </p>
        </div>
      </div>
    </div>
  );
}
