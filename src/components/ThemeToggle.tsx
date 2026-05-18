import { Moon, Sun, Circle } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";

const ITEMS: { value: Theme; label: string; Icon: typeof Moon }[] = [
  { value: "dark",  label: "Dark",  Icon: Moon },
  { value: "light", label: "Light", Icon: Sun },
  { value: "oled",  label: "OLED",  Icon: Circle },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-sm border border-border bg-surface-2 p-0.5"
    >
      {ITEMS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={label}
            onClick={() => setTheme(value)}
            className={
              "flex items-center justify-center rounded-[3px] transition-colors " +
              (compact ? "h-6 w-6" : "h-7 w-7") +
              " " +
              (active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground")
            }
          >
            <Icon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}
