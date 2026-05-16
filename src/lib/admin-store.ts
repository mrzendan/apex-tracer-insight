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

export type ZoneTag = "team" | "camera" | "minimap" | "timer" | "map_name";
export type Zone = { id: string; name: string; tag: ZoneTag; x: number; y: number; w: number; h: number };
export type ZoneMode = "vod" | "camera";

const initialVod: Zone[] = [
  { id: "v-minimap",  name: "Minimap",    tag: "minimap",  x: 20,   y: 30,   w: 320, h: 320 },
  { id: "v-map-name", name: "Map name",   tag: "map_name", x: 360,  y: 170,  w: 380, h: 80  },
  { id: "v-timer",    name: "Round timer",tag: "timer",    x: 20,   y: 380,  w: 320, h: 90  },
  { id: "v-team-l",   name: "Team panel", tag: "team",     x: 20,   y: 720,  w: 540, h: 280 },
];
const initialCamera: Zone[] = [
  { id: "c-name",  name: "Player name",  tag: "camera",  x: 60,   y: 730, w: 480, h: 90 },
  { id: "c-squad", name: "Squad badge",  tag: "team",    x: 60,   y: 830, w: 480, h: 120 },
  { id: "c-time",  name: "Round timer",  tag: "timer",   x: 60,   y: 280, w: 320, h: 80  },
  { id: "c-mini",  name: "Minimap",      tag: "minimap", x: 20,   y: 20,  w: 360, h: 260 },
];

type State = {
  teams: Team[];
  matches: MatchFull[];
  tournaments: Tournament[];
  polygons: Polygon[];
  zones: { vod: Zone[]; camera: Zone[] };
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
  zones: { vod: initialVod, camera: initialCamera },
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

export function setZones(mode: ZoneMode, zones: Zone[]) {
  state = { ...state, zones: { ...state.zones, [mode]: zones } };
  emit();
}
export function getMinimapZone(mode: ZoneMode = "vod"): Zone | undefined {
  return state.zones[mode].find((z) => z.tag === "minimap");
}