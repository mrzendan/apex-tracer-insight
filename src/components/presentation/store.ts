import { useSyncExternalStore } from "react";

const KEY = "apex-presentation-content-v1";
const LKEY = "apex-presentation-layout-v1";

type Store = Record<string, string>;
let state: Store = load();
const listeners = new Set<() => void>();

function load(): Store {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
function persist() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
function emit() { listeners.forEach((l) => l()); }

export function setText(id: string, value: string) {
  state = { ...state, [id]: value };
  persist(); emit();
}
export function resetAll() {
  state = {};
  layout = {};
  persist(); persistLayout(); emit();
}
export function exportAll(): Store { return state; }
export function importAll(s: Store) { state = { ...s }; persist(); emit(); }

export function useText(id: string, fallback: string): string {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state[id] ?? fallback,
    () => fallback,
  );
}

// ───────────────────── Layout (boxes / arrow endpoints) ─────────────────────

export type BoxLayout = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };
export type ArrowLayout = { pts: Pt[] };
export type AnyLayout = BoxLayout | ArrowLayout;

type LayoutStore = Record<string, AnyLayout>;
let layout: LayoutStore = loadLayout();

function loadLayout(): LayoutStore {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(LKEY) || "{}"); } catch { return {}; }
}
function persistLayout() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LKEY, JSON.stringify(layout)); } catch {}
}

export function setLayout(id: string, value: AnyLayout) {
  layout = { ...layout, [id]: value };
  persistLayout(); emit();
}
export function resetLayout(id?: string) {
  if (!id) { layout = {}; }
  else { const { [id]: _, ...rest } = layout; layout = rest; }
  persistLayout(); emit();
}

export function useBox(id: string, fallback: BoxLayout): BoxLayout {
  const cacheRef = (useBox as any)._c ||= new Map<string, { src: unknown; val: BoxLayout }>();
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => {
      const v = layout[id] as BoxLayout | undefined;
      if (v) {
        const c = cacheRef.get(id);
        if (c && c.src === v) return c.val;
        cacheRef.set(id, { src: v, val: v });
        return v;
      }
      const c = cacheRef.get(id);
      if (c && c.src === "fallback") return c.val;
      cacheRef.set(id, { src: "fallback", val: fallback });
      return fallback;
    },
    () => fallback,
  );
}
/** Reads an arrow layout, transparently migrating the legacy {x1,y1,x2,y2} shape. */
export function useArrow(id: string, fallback: ArrowLayout): ArrowLayout {
  const cacheRef = (useArrow as any)._c ||= new Map<string, { src: unknown; val: ArrowLayout }>();
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => {
      const v = layout[id] as any;
      const cached = cacheRef.get(id);
      if (v && Array.isArray(v.pts)) {
        if (cached && cached.src === v) return cached.val;
        cacheRef.set(id, { src: v, val: v as ArrowLayout });
        return v as ArrowLayout;
      }
      if (v && typeof v.x1 === "number") {
        if (cached && cached.src === v) return cached.val;
        const migrated = { pts: [{ x: v.x1, y: v.y1 }, { x: v.x2, y: v.y2 }] };
        cacheRef.set(id, { src: v, val: migrated });
        return migrated;
      }
      if (cached && cached.src === "fallback") return cached.val;
      cacheRef.set(id, { src: "fallback", val: fallback });
      return fallback;
    },
    () => fallback,
  );
}