import { useState } from "react";
import { setText, useText } from "./store";

export const PALETTE: { name: string; value: string }[] = [
  { name: "Primary",     value: "var(--primary)" },
  { name: "Cyan",        value: "var(--cyan)" },
  { name: "Success",     value: "var(--success)" },
  { name: "Warning",     value: "var(--warning)" },
  { name: "Destructive", value: "var(--destructive)" },
  { name: "Foreground",  value: "var(--foreground)" },
  { name: "Muted",       value: "var(--muted-foreground)" },
  { name: "Accent",      value: "var(--accent-foreground)" },
];

export function useColor(id: string, fallback: string): string {
  return useText(`${id}.color`, fallback);
}

/** Small swatch button + popover palette. Use only in editing mode. */
export function ColorButton({
  id, fallback, className, title = "Цвет",
}: { id: string; fallback: string; className?: string; title?: string }) {
  const current = useColor(id, fallback);
  const [open, setOpen] = useState(false);
  return (
    <span className={"relative inline-flex " + (className ?? "")}>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="h-5 w-5 rounded-full ring-1 ring-background shadow"
        style={{ background: current }}
        title={title}
      />
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-[180px] rounded-md border border-border bg-surface p-2 shadow-xl"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Цвет</span>
            <button onClick={() => setOpen(false)} className="text-[11px] text-muted-foreground hover:text-foreground">×</button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {PALETTE.map((c) => {
              const active = c.value === current;
              return (
                <button
                  key={c.value}
                  onClick={() => { setText(`${id}.color`, c.value); setOpen(false); }}
                  className={"h-7 w-7 rounded ring-1 " + (active ? "ring-foreground" : "ring-border hover:ring-foreground/60")}
                  style={{ background: c.value }}
                  title={c.name}
                />
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}