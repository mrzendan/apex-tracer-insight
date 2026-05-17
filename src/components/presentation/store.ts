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
/** Optional binding: arrow vertex is anchored to a box at relative (ax,ay) in [0..1]. */
export type Binding = { boxId: string; ax: number; ay: number };
export type ArrowLayout = { pts: Pt[]; bindings?: (Binding | null)[] };
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

// ────── Box registry — defaults registered by every Movable so arrows can bind ──────
const boxDefaults: Record<string, BoxLayout> = {};
export function registerBoxDefault(id: string, box: BoxLayout) {
  if (!boxDefaults[id]) boxDefaults[id] = box;
}
export function getBox(id: string): BoxLayout | undefined {
  const v = layout[id] as BoxLayout | undefined;
  if (v && typeof (v as any).w === "number") return v;
  return boxDefaults[id];
}
export function listBoxes(): Array<{ id: string; box: BoxLayout }> {
  const ids = new Set<string>([...Object.keys(boxDefaults), ...Object.keys(layout)]);
  const out: Array<{ id: string; box: BoxLayout }> = [];
  ids.forEach((id) => {
    const b = getBox(id);
    if (b && typeof (b as any).w === "number") out.push({ id, box: b });
  });
  return out;
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
  const cacheRef = (useArrow as any)._c ||= new Map<string, { src: unknown; val: ArrowLayout; bsig: string }>();
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => {
      const v = layout[id] as any;
      // Resolve canonical ArrowLayout from possibly-legacy storage.
      let arr: ArrowLayout;
      let srcKey: unknown;
      if (v && Array.isArray(v.pts)) { arr = v as ArrowLayout; srcKey = v; }
      else if (v && typeof v.x1 === "number") {
        arr = { pts: [{ x: v.x1, y: v.y1 }, { x: v.x2, y: v.y2 }] };
        srcKey = v;
      } else { arr = fallback; srcKey = "fallback"; }
      // Compute signature of any bound box layouts so the arrow re-renders
      // whenever a box it's anchored to is moved or resized.
      const bsig = (arr.bindings ?? []).map((b) => {
        if (!b) return "_";
        const bx = (layout[b.boxId] as BoxLayout | undefined) ?? boxDefaults[b.boxId];
        return bx ? `${bx.x},${bx.y},${bx.w},${bx.h}` : "?";
      }).join("|");
      const cached = cacheRef.get(id);
      if (cached && cached.src === srcKey && cached.bsig === bsig) return cached.val;
      const val: ArrowLayout = { pts: arr.pts, bindings: arr.bindings };
      cacheRef.set(id, { src: srcKey, val, bsig });
      return val;
    },
    () => fallback,
  );
}