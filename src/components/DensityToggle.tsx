import { Minus, Equal, Plus } from "lucide-react";
import { useDensity, type Density } from "@/lib/density";

const ITEMS: { value: Density; label: string; Icon: typeof Minus }[] = [
  { value: "compact", label: "Compact", Icon: Minus },
  { value: "normal",  label: "Normal",  Icon: Equal },
  { value: "large",   label: "Large",   Icon: Plus },
];

export function DensityToggle({ compact = false }: { compact?: boolean }) {
  const { density, setDensity } = useDensity();
  return (
    <div
      role="radiogroup"
      aria-label="UI density"
      className="inline-flex items-center gap-0.5 rounded-sm border border-border bg-surface-2 p-0.5"
    >
      {ITEMS.map(({ value, label, Icon }) => {
        const active = density === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={label}
            onClick={() => setDensity(value)}
            className={
              "flex items-center justify-center rounded-[3px] transition-colors " +
              (compact ? "h-6 w-6" : "h-7 w-7") + " " +
              (active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground")
            }
          >
            <Icon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} strokeWidth={2.4} />
          </button>
        );
      })}
    </div>
  );
}
