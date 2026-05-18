import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Density = "compact" | "normal" | "large";
const KEY = "apex-density";

type Ctx = { density: Density; setDensity: (d: Density) => void };
const DensityCtx = createContext<Ctx | null>(null);

function apply(d: Density) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("density-compact", "density-large");
  if (d === "compact") root.classList.add("density-compact");
  else if (d === "large") root.classList.add("density-large");
}

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setStateDensity] = useState<Density>("normal");

  useEffect(() => {
    try {
      const saved = (localStorage.getItem(KEY) as Density | null) ?? "normal";
      setStateDensity(saved);
      apply(saved);
    } catch {
      apply("normal");
    }
  }, []);

  const setDensity = (d: Density) => {
    setStateDensity(d);
    apply(d);
    try { localStorage.setItem(KEY, d); } catch {}
  };

  return <DensityCtx.Provider value={{ density, setDensity }}>{children}</DensityCtx.Provider>;
}

export function useDensity() {
  const c = useContext(DensityCtx);
  if (!c) return { density: "normal" as Density, setDensity: () => {} };
  return c;
}
