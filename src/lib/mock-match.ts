// Mock data for the Apex Stats Match Viewer.
// Coordinates are normalized in [0..1] over the map viewport.

export type Tournament = { id: string; name: string };
export type Match = { id: string; name: string; tournamentId: string; mapId: string; durationSec: number };
export type ApexMap = { id: string; name: string };

export const tournaments: Tournament[] = [
  { id: "algs-2026-split-1", name: "ALGS 2026 — Split 1 Playoffs" },
  { id: "esl-pro-league-12", name: "ESL Apex Pro League S12" },
  { id: "scrims-eu-week-4", name: "EU Pro Scrims — Week 4" },
];

export const maps: ApexMap[] = [
  { id: "worlds-edge", name: "World's Edge" },
  { id: "kings-canyon", name: "King's Canyon" },
  { id: "storm-point", name: "Storm Point" },
  { id: "broken-moon", name: "Broken Moon" },
];

export const matches: Match[] = [
  { id: "m-001", name: "Game 1 — World's Edge", tournamentId: "algs-2026-split-1", mapId: "worlds-edge", durationSec: 1320 },
  { id: "m-002", name: "Game 2 — Storm Point", tournamentId: "algs-2026-split-1", mapId: "storm-point", durationSec: 1480 },
  { id: "m-003", name: "Game 3 — Broken Moon", tournamentId: "algs-2026-split-1", mapId: "broken-moon", durationSec: 1190 },
];

export type Team = {
  id: string;
  tag: string;
  name: string;
  color: string; // hex
  players: string[];
  placement: number;
  kills: number;
  alive: boolean;
};

export const teams: Team[] = [
  { id: "t-tsm",  tag: "TSM",  name: "TSM",            color: "#ff5b12", players: ["ImperialHal", "Verhulst", "Reps"],     placement: 1, kills: 11, alive: true },
  { id: "t-drg",  tag: "DRG",  name: "DarkZero",       color: "#22c4f5", players: ["Zer0", "Gild", "Sharky"],               placement: 2, kills: 9,  alive: true },
  { id: "t-noc",  tag: "NOC",  name: "NRG",            color: "#ffd23f", players: ["Sweet", "Gent", "nafen"],               placement: 3, kills: 7,  alive: true },
  { id: "t-c9",   tag: "C9",   name: "Cloud9",         color: "#a78bfa", players: ["Wxltzy", "Genburten", "Mande"],         placement: 5, kills: 6,  alive: true },
  { id: "t-fa",   tag: "FA",   name: "Furia",          color: "#f87171", players: ["Pandxrz", "Albralelie", "Rambeau"],     placement: 8, kills: 4,  alive: false },
  { id: "t-lg",   tag: "LG",   name: "Luminosity",     color: "#34d399", players: ["Knoqd", "Monsoon", "Lou"],              placement: 11, kills: 5, alive: false },
  { id: "t-flq",  tag: "FLQ",  name: "FaZe Clan",      color: "#fb923c", players: ["Sikezz", "rpr", "Snip3down"],           placement: 6, kills: 3,  alive: true },
  { id: "t-100t", tag: "100T", name: "100 Thieves",    color: "#fde68a", players: ["Pandxrz", "Senoxe", "Keon"],            placement: 14, kills: 2, alive: false },
  { id: "t-sen",  tag: "SEN",  name: "Sentinels",      color: "#e879f9", players: ["Naghz", "Zenoo", "Ojrein"],             placement: 4, kills: 8,  alive: true },
  { id: "t-tl",   tag: "TL",   name: "Team Liquid",    color: "#60a5fa", players: ["Hakis", "Yuki", "Keon"],                placement: 7, kills: 5,  alive: true },
  { id: "t-mv",   tag: "MV",   name: "Moist Esports",  color: "#86efac", players: ["Xeratricky", "Frexs", "Effect"],        placement: 9, kills: 3,  alive: true },
  { id: "t-ofg",  tag: "OFG",  name: "Oxygen",         color: "#fca5a5", players: ["Sweetdreams", "Reptar", "rkn"],         placement: 13, kills: 1, alive: false },
];

// Generate a deterministic trajectory per team across the map.
function seedRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export type TrajectoryPoint = { t: number; x: number; y: number };

export function generateTrajectory(seed: number, durationSec: number): TrajectoryPoint[] {
  const rnd = seedRand(seed);
  const points: TrajectoryPoint[] = [];
  let x = 0.15 + rnd() * 0.7;
  let y = 0.15 + rnd() * 0.7;
  let vx = (rnd() - 0.5) * 0.01;
  let vy = (rnd() - 0.5) * 0.01;
  const step = 6; // seconds
  for (let t = 0; t <= durationSec; t += step) {
    vx += (rnd() - 0.5) * 0.006;
    vy += (rnd() - 0.5) * 0.006;
    vx = Math.max(-0.012, Math.min(0.012, vx));
    vy = Math.max(-0.012, Math.min(0.012, vy));
    x += vx;
    y += vy;
    // shrink toward center over time (ring effect)
    const ringPull = 0.0009 * (t / durationSec);
    x += (0.5 - x) * ringPull;
    y += (0.5 - y) * ringPull;
    x = Math.max(0.04, Math.min(0.96, x));
    y = Math.max(0.04, Math.min(0.96, y));
    points.push({ t, x, y });
  }
  return points;
}

export type RingPhase = { startSec: number; endSec: number; cx: number; cy: number; r: number };

export const ringPhases: RingPhase[] = [
  { startSec: 0,    endSec: 240,  cx: 0.50, cy: 0.50, r: 0.48 },
  { startSec: 240,  endSec: 540,  cx: 0.48, cy: 0.52, r: 0.34 },
  { startSec: 540,  endSec: 840,  cx: 0.45, cy: 0.50, r: 0.22 },
  { startSec: 840,  endSec: 1140, cx: 0.46, cy: 0.49, r: 0.13 },
  { startSec: 1140, endSec: 1480, cx: 0.47, cy: 0.49, r: 0.06 },
];

export type GameEvent = {
  t: number;
  type: "kill" | "knock" | "ring" | "care" | "wipe";
  team?: string;
  label: string;
};

export const events: GameEvent[] = [
  { t: 38,   type: "ring",  label: "Ring 1 closing" },
  { t: 142,  type: "kill",  team: "TSM",  label: "TSM eliminates OFG player" },
  { t: 215,  type: "knock", team: "DRG",  label: "DRG knock on C9" },
  { t: 260,  type: "ring",  label: "Ring 2 closing" },
  { t: 388,  type: "wipe",  team: "TSM",  label: "TSM wipes 100T" },
  { t: 510,  type: "care",  label: "Care package dropped" },
  { t: 612,  type: "kill",  team: "SEN",  label: "Sentinels triple kill" },
  { t: 730,  type: "ring",  label: "Ring 3 closing" },
  { t: 845,  type: "wipe",  team: "DRG",  label: "DRG wipes FA" },
  { t: 980,  type: "kill",  team: "NOC",  label: "NRG eliminates LG" },
  { t: 1080, type: "ring",  label: "Ring 4 closing" },
  { t: 1210, type: "wipe",  team: "TSM",  label: "TSM wipes MV — endgame" },
];
