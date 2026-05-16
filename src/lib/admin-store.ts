import { useSyncExternalStore } from "react";
import {
  teams as seedTeams,
  matches as seedMatches,
  tournaments as seedTournaments,
  type Team,
  type Tournament,
  type MatchFull,
} from "@/lib/mock-match";

export type PolygonTag = "forbidden" | "safe";
export type Polygon = {
  id: string;
  mapId: string;
  name: string;
  tag: PolygonTag;
  /** Normalized [0..1] points over the map. */
  points: { x: number; y: number }[];
};

type State = {
  teams: Team[];
  matches: MatchFull[];
  tournaments: Tournament[];
  polygons: Polygon[];
};

// Seed: assign default teamIds to each match (rotate 20 teams as participants).
const initialMatches: MatchFull[] = seedMatches.map((m, i) => ({
  ...m,
  mapIds: [m.mapId],
  vodLink: "",
  teamIds: seedTeams.map((t) => t.id),
  teamVods: {},
}));

let state: State = {
  teams: seedTeams,
  matches: initialMatches,
  tournaments: seedTournaments,
  polygons: [],
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getSnapshot = () => state;

export function useAdminStore(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setTeams(teams: Team[]) {
  state = { ...state, teams };
  emit();
}
export function setMatches(matches: MatchFull[]) {
  state = { ...state, matches };
  emit();
}
export function updateMatch(id: string, patch: Partial<MatchFull>) {
  state = {
    ...state,
    matches: state.matches.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  };
  emit();
}
export function updateTeam(id: string, patch: Partial<Team>) {
  state = {
    ...state,
    teams: state.teams.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  };
  emit();
}
export function setTournaments(tournaments: Tournament[]) {
  state = { ...state, tournaments };
  emit();
}

export function setPolygons(polygons: Polygon[]) {
  state = { ...state, polygons };
  emit();
}
export function addPolygon(p: Polygon) {
  state = { ...state, polygons: [...state.polygons, p] };
  emit();
}
export function updatePolygon(id: string, patch: Partial<Polygon>) {
  state = {
    ...state,
    polygons: state.polygons.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  };
  emit();
}
export function removePolygon(id: string) {
  state = { ...state, polygons: state.polygons.filter((p) => p.id !== id) };
  emit();
}