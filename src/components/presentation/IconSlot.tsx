import { useState, type ComponentType } from "react";
import * as Lucide from "lucide-react";
import { setText, useText } from "./store";

/** Curated catalog of icons that make sense in diagrams/schemas. */
const ICON_NAMES = [
  "Database", "Server", "Globe", "Code2", "Cloud", "CloudUpload", "HardDrive",
  "Cpu", "Layers", "GitBranch", "Network", "Workflow", "Boxes", "Box",
  "Trophy", "Gamepad2", "Map", "MapPin", "Users", "User", "Target", "Flag",
  "Clock", "Settings", "Sliders", "Filter", "Play", "Eye", "BarChart3",
  "TrendingUp", "Crosshair", "Route", "Rocket", "Bot", "Shield", "ShieldCheck",
  "Camera", "Image", "FileText", "FolderOpen", "Calendar", "Tag", "Key",
  "Link", "Hash", "Brain", "BrainCircuit", "Bell", "Star", "Heart",
] as const;

function resolve(name: string): ComponentType<{ className?: string; strokeWidth?: number }> {
  const M = Lucide as unknown as Record<string, ComponentType<any>>;
  return (M[name] ?? Lucide.Square) as any;
}

export function IconSlot({
  id, defaultName, editing, className, strokeWidth = 1.8,
}: {
  id: string;
  defaultName: string;
  editing: boolean;
  className?: string;
  strokeWidth?: number;
}) {
  const name = useText(id, defaultName);
  const Icon = resolve(name);
  const [open, setOpen] = useState(false);

  if (!editing) return <Icon className={className} strokeWidth={strokeWidth} />;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="rounded ring-1 ring-primary/40 hover:ring-primary"
        title="Сменить иконку"
      >
        <Icon className={className} strokeWidth={strokeWidth} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-[280px] rounded-md border border-border bg-surface p-2 shadow-xl"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Иконка</span>
            <button onClick={() => setOpen(false)} className="text-[11px] text-muted-foreground hover:text-foreground">×</button>
          </div>
          <div className="grid max-h-[260px] grid-cols-8 gap-1 overflow-y-auto">
            {ICON_NAMES.map((n) => {
              const I = resolve(n);
              const active = n === name;
              return (
                <button
                  key={n}
                  onClick={() => { setText(id, n); setOpen(false); }}
                  className={"flex h-7 w-7 items-center justify-center rounded " + (active ? "bg-primary/20 ring-1 ring-primary" : "hover:bg-muted")}
                  title={n}
                >
                  <I className="h-4 w-4 text-foreground" strokeWidth={1.8} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}