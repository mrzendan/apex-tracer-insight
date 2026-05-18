import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "dark" | "light" | "oled";
const KEY = "apex-theme";

type Ctx = { theme: Theme; setTheme: (t: Theme) => void };
const ThemeCtx = createContext<Ctx | null>(null);

function apply(t: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("light", "oled", "dark");
  // Keep "dark" as the implicit default; only add a class for non-default themes.
  if (t === "light") root.classList.add("light");
  else if (t === "oled") root.classList.add("oled");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    try {
      const saved = (localStorage.getItem(KEY) as Theme | null) ?? "dark";
      setThemeState(saved);
      apply(saved);
    } catch {
      apply("dark");
    }
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    apply(t);
    try { localStorage.setItem(KEY, t); } catch {}
  };

  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const c = useContext(ThemeCtx);
  if (!c) return { theme: "dark" as Theme, setTheme: () => {} };
  return c;
}
