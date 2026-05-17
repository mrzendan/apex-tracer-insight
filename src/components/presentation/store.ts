import { useSyncExternalStore } from "react";

const KEY = "apex-presentation-content-v1";

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
  persist(); emit();
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