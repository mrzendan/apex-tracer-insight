import { useSyncExternalStore } from "react";

export type Diagram = { id: string; name: string; code: string; updatedAt: number };
export type Slide = { id: string; title: string; body: string };

type State = {
  architecture: Diagram[];
  database: Diagram[];
  slides: Slide[];
};

const STORAGE_KEY = "apex-planning-v1";

const defaultArchitecture: Diagram[] = [
  {
    id: "arch-1",
    name: "System overview",
    updatedAt: Date.now(),
    code: `flowchart LR
  VOD[Tournament VOD] --> Ingest[Frame ingest]
  Ingest --> Zones[Zone crops]
  Zones --> HSV[HSV team detect]
  Zones --> Mini[Minimap tracker]
  Zones --> Cam[Camera tracker]
  HSV --> Store[(Match store)]
  Mini --> Store
  Cam --> Store
  Store --> UI[Match viewer UI]
  Store --> Admin[Admin console]`,
  },
];

const defaultDatabase: Diagram[] = [
  {
    id: "db-1",
    name: "Core schema",
    updatedAt: Date.now(),
    code: `erDiagram
  TOURNAMENT ||--o{ MATCH : has
  MATCH ||--o{ MATCH_MAP : plays
  MAP ||--o{ MATCH_MAP : used_in
  MATCH ||--o{ MATCH_TEAM : includes
  TEAM ||--o{ MATCH_TEAM : participates
  MATCH_TEAM ||--o{ POV_VOD : has
  MAP ||--o{ POLYGON : contains
  ZONE_PRESET ||--o{ ZONE : groups

  TOURNAMENT { string id PK; string name; date startDate; date endDate; string region; string type }
  MATCH      { string id PK; string tournamentId FK; string name; int durationSec; string vodLink }
  MAP        { string id PK; string name; string image }
  TEAM       { string id PK; string tag; string name; string logo }
  POLYGON    { string id PK; string mapId FK; string name; string tag; json points }
  ZONE       { string id PK; string name; string tag; int x; int y; int w; int h }`,
  },
];

const defaultSlides: Slide[] = [
  { id: "s-1", title: "Apex Stats", body: "Observer-driven tournament analytics\n\n— camera tracking\n— minimap detection\n— team color HSV" },
  { id: "s-2", title: "Problem", body: "Manual VOD review is slow.\nObservers miss decisive engagements.\nTeams lack post-match heatmaps." },
  { id: "s-3", title: "Pipeline", body: "1. Ingest VOD frames\n2. Crop HUD zones\n3. Detect teams, minimap, camera\n4. Persist to match store\n5. Render viewer + admin tools" },
];

function load(): State {
  if (typeof window === "undefined") {
    return { architecture: defaultArchitecture, database: defaultDatabase, slides: defaultSlides };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { architecture: defaultArchitecture, database: defaultDatabase, slides: defaultSlides };
    const parsed = JSON.parse(raw) as Partial<State>;
    return {
      architecture: parsed.architecture?.length ? parsed.architecture : defaultArchitecture,
      database: parsed.database?.length ? parsed.database : defaultDatabase,
      slides: parsed.slides?.length ? parsed.slides : defaultSlides,
    };
  } catch {
    return { architecture: defaultArchitecture, database: defaultDatabase, slides: defaultSlides };
  }
}

let state: State = load();
const listeners = new Set<() => void>();
const persist = () => {
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }
};
const emit = () => { persist(); listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => state;

export function usePlanning(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

type Kind = "architecture" | "database";

export function addDiagram(kind: Kind, name = "Untitled") {
  const d: Diagram = {
    id: `${kind}-${Date.now()}`,
    name,
    updatedAt: Date.now(),
    code: kind === "database"
      ? "erDiagram\n  A ||--o{ B : has\n  A { string id PK }\n  B { string id PK; string aId FK }"
      : "flowchart LR\n  A[Start] --> B[Process] --> C[End]",
  };
  state = { ...state, [kind]: [...state[kind], d] };
  emit();
  return d.id;
}
export function updateDiagram(kind: Kind, id: string, patch: Partial<Diagram>) {
  state = { ...state, [kind]: state[kind].map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d)) };
  emit();
}
export function removeDiagram(kind: Kind, id: string) {
  state = { ...state, [kind]: state[kind].filter((d) => d.id !== id) };
  emit();
}

export function addSlide() {
  const s: Slide = { id: `slide-${Date.now()}`, title: "New slide", body: "" };
  state = { ...state, slides: [...state.slides, s] };
  emit();
  return s.id;
}
export function updateSlide(id: string, patch: Partial<Slide>) {
  state = { ...state, slides: state.slides.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
  emit();
}
export function removeSlide(id: string) {
  state = { ...state, slides: state.slides.filter((s) => s.id !== id) };
  emit();
}
export function moveSlide(id: string, dir: -1 | 1) {
  const arr = state.slides.slice();
  const i = arr.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  state = { ...state, slides: arr };
  emit();
}