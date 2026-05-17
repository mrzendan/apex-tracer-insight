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
export type ArrowLayout = { x1: number; y1: number; x2: number; y2: number };
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
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => (layout[id] as BoxLayout) ?? fallback,
    () => fallback,
  );
}
export function useArrow(id: string, fallback: ArrowLayout): ArrowLayout {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => (layout[id] as ArrowLayout) ?? fallback,
    () => fallback,
  );
}