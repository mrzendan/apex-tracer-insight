// Mock data for the Apex Stats Match Viewer.
// Coordinates are normalized in [0..1] over the map viewport.

import worldsEdgeImg from "@/assets/maps/worlds-edge.png";
import kingsCanyonImg from "@/assets/maps/kings-canyon.png";
import stormPointImg from "@/assets/maps/storm-point.png";
import brokenMoonImg from "@/assets/maps/broken-moon.png";
import olympusImg from "@/assets/maps/olympus.png";
import eDistrictImg from "@/assets/maps/e-district.png";
import liquidLogo from "@/assets/teams/liquid.png";
import fazeLogo from "@/assets/teams/faze.png";
import luminosityLogo from "@/assets/teams/luminosity.png";
import darkzeroLogo from "@/assets/teams/darkzero.png";

export type TournamentType = "LAN" | "Online" | "Qualifier";
export type TournamentRegion = "EMEA" | "APAC" | "North America" | "South America";
export type Tournament = {
  id: string;
  name: string;
  startDate: string; // ISO yyyy-mm-dd
  endDate: string;   // ISO yyyy-mm-dd
  year: number;      // 1..6
  type: TournamentType;
  region: TournamentRegion;
};
export type Match = { id: string; name: string; tournamentId: string; mapId: string; durationSec: number };

/** Extended fields layered on top of Match for the admin UI. */
export type MatchExtras = {
  vodLink?: string;
  /** Ordered list of maps played within this match. Falls back to [mapId]. */
  mapIds?: string[];
  /** Per-team POV VOD links (YouTube URLs). */
  teamVods?: Record<string, string>;
  /** Teams that participated. */
  teamIds?: string[];
};
export type MatchFull = Match & MatchExtras;
export type ApexMap = { id: string; name: string; image: string };

export const tournaments: Tournament[] = [
  { id: "algs-2026-split-1", name: "ALGS 2026 — Split 1 Playoffs", startDate: "2026-02-14", endDate: "2026-02-18", year: 6, type: "LAN",       region: "North America" },
  { id: "esl-pro-league-12", name: "ESL Apex Pro League S12",      startDate: "2026-03-02", endDate: "2026-03-29", year: 6, type: "Online",    region: "EMEA" },
  { id: "scrims-eu-week-4",  name: "EU Pro Scrims — Week 4",       startDate: "2026-04-06", endDate: "2026-04-10", year: 6, type: "Qualifier", region: "EMEA" },
];

export const maps: ApexMap[] = [
  { id: "worlds-edge",  name: "World's Edge",  image: worldsEdgeImg },
  { id: "kings-canyon", name: "King's Canyon", image: kingsCanyonImg },
  { id: "storm-point",  name: "Storm Point",   image: stormPointImg },
  { id: "broken-moon",  name: "Broken Moon",   image: brokenMoonImg },
  { id: "olympus",      name: "Olympus",       image: olympusImg },
  { id: "e-district",   name: "E-District",    image: eDistrictImg },
];

export const matches: Match[] = [
  { id: "m-001", name: "Game 1 — World's Edge", tournamentId: "algs-2026-split-1", mapId: "worlds-edge", durationSec: 1320 },
  { id: "m-002", name: "Game 2 — Storm Point",  tournamentId: "algs-2026-split-1", mapId: "storm-point", durationSec: 1480 },
  { id: "m-003", name: "Game 3 — Broken Moon",  tournamentId: "algs-2026-split-1", mapId: "broken-moon", durationSec: 1190 },
  { id: "m-004", name: "Game 4 — E-District",   tournamentId: "algs-2026-split-1", mapId: "e-district",  durationSec: 1260 },
  { id: "m-005", name: "Game 5 — Olympus",      tournamentId: "esl-pro-league-12", mapId: "olympus",     durationSec: 1400 },
  { id: "m-006", name: "Game 6 — King's Canyon",tournamentId: "esl-pro-league-12", mapId: "kings-canyon",durationSec: 1320 },
];

export type Team = {
  id: string;
  tag: string;
  name: string;
  color: string;
  /** Optional logo URL. When absent, the UI falls back to the site logo. */
  logo?: string;
  players: string[];
  placement: number;
  kills: number;
  alive: boolean;
};

export const teams: Team[] = [
  { id: "t-tsm",  tag: "TSM",  name: "TSM",            color: "#ff5b12", players: ["ImperialHal", "Verhulst", "Reps"],     placement: 1,  kills: 11, alive: true  },
  { id: "t-drg",  tag: "DZ",   name: "DarkZero",       color: "#22c4f5", logo: darkzeroLogo, players: ["Zer0", "Gild", "Sharky"],              placement: 2,  kills: 9,  alive: true  },
  { id: "t-nrg",  tag: "NRG",  name: "NRG",            color: "#ffd23f", players: ["Sweet", "Gent", "nafen"],              placement: 3,  kills: 7,  alive: true  },
  { id: "t-sen",  tag: "SEN",  name: "Sentinels",      color: "#e879f9", players: ["Naghz", "Zenoo", "Ojrein"],            placement: 4,  kills: 8,  alive: true  },
  { id: "t-c9",   tag: "C9",   name: "Cloud9",         color: "#a78bfa", players: ["Wxltzy", "Genburten", "Mande"],        placement: 5,  kills: 6,  alive: true  },
  { id: "t-faze", tag: "FAZE", name: "FaZe Clan",      color: "#fb923c", logo: fazeLogo, players: ["Sikezz", "rpr", "Snip3down"],          placement: 6,  kills: 3,  alive: true  },
  { id: "t-tl",   tag: "TL",   name: "Team Liquid",    color: "#60a5fa", logo: liquidLogo, players: ["Hakis", "Yuki", "Keon"],               placement: 7,  kills: 5,  alive: true  },
  { id: "t-fa",   tag: "FA",   name: "Furia",          color: "#f87171", players: ["Pandxrz", "Albralelie", "Rambeau"],    placement: 8,  kills: 4,  alive: true  },
  { id: "t-mv",   tag: "MV",   name: "Moist Esports",  color: "#86efac", players: ["Xeratricky", "Frexs", "Effect"],       placement: 9,  kills: 3,  alive: true  },
  { id: "t-aw",   tag: "AW",   name: "Alliance",       color: "#38bdf8", players: ["Vaifs", "Reptar", "Yuki"],             placement: 10, kills: 4,  alive: true  },
  { id: "t-lg",   tag: "LG",   name: "Luminosity",     color: "#34d399", logo: luminosityLogo, players: ["Knoqd", "Monsoon", "Lou"],             placement: 11, kills: 5,  alive: false },
  { id: "t-vk",   tag: "VK",   name: "Vexed Gaming",   color: "#facc15", players: ["Taisheen", "rynnv", "Bjornfot"],       placement: 12, kills: 4,  alive: false },
  { id: "t-ofg",  tag: "OXG",  name: "Oxygen",         color: "#fca5a5", players: ["Sweetdreams", "Reptar", "rkn"],        placement: 13, kills: 1,  alive: false },
  { id: "t-100t", tag: "100T", name: "100 Thieves",    color: "#fde68a", players: ["Pandxrz", "Senoxe", "Keon"],           placement: 14, kills: 2,  alive: false },
  { id: "t-ssg",  tag: "SSG",  name: "Spacestation",   color: "#22d3ee", players: ["Frexs", "RamBeau", "noiizyy"],         placement: 15, kills: 3,  alive: false },
  { id: "t-dz2",  tag: "ROC",  name: "Rocket",         color: "#f472b6", players: ["Cl0udyy", "Pioneer", "Ulvi"],          placement: 16, kills: 2,  alive: false },
  { id: "t-eg",   tag: "EG",   name: "Evil Geniuses",  color: "#84cc16", players: ["Dropped", "Ras", "Snowy"],             placement: 17, kills: 2,  alive: false },
  { id: "t-aft",  tag: "AFT",  name: "Aftershock",     color: "#c084fc", players: ["LamoBro", "Xera", "Zac"],              placement: 18, kills: 1,  alive: false },
  { id: "t-ssg2", tag: "WTL",  name: "Wettle",         color: "#fb7185", players: ["Wettle", "Garrik", "Pollen"],          placement: 19, kills: 0,  alive: false },
  { id: "t-xyz",  tag: "XYZ",  name: "Crazy Raccoon",  color: "#5eead4", players: ["MatuFps", "Suzaku", "Ryotsu"],         placement: 20, kills: 1,  alive: false },
];

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
  const step = 6;
  for (let t = 0; t <= durationSec; t += step) {
    vx += (rnd() - 0.5) * 0.006;
    vy += (rnd() - 0.5) * 0.006;
    vx = Math.max(-0.012, Math.min(0.012, vx));
    vy = Math.max(-0.012, Math.min(0.012, vy));
    x += vx;
    y += vy;
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

/**
 * Six concentric ring phases. Each child ring is half the radius of its parent
 * and sits fully inside the parent at a fixed offset (not centered).
 */
const RING_OFFSETS: { fx: number; fy: number }[] = [
  { fx: 0.0,  fy: 0.0  },
  { fx: 0.35, fy: -0.2 },
  { fx: -0.3, fy: 0.25 },
  { fx: 0.2,  fy: 0.3  },
  { fx: -0.25,fy: -0.15},
  { fx: 0.15, fy: 0.1  },
];

function buildRingPhases(): RingPhase[] {
  const PHASE_BOUNDS: [number, number][] = [
    [0,    220 ],
    [220,  480 ],
    [480,  740 ],
    [740,  980 ],
    [980,  1200],
    [1200, 1480],
  ];
  const rings: RingPhase[] = [];
  let cx = 0.5, cy = 0.5, r = 0.46;
  for (let i = 0; i < 6; i++) {
    if (i > 0) {
      const parent = rings[i - 1];
      const off = RING_OFFSETS[i];
      r = parent.r / 2;
      cx = parent.cx + parent.r * off.fx;
      cy = parent.cy + parent.r * off.fy;
    }
    rings.push({ startSec: PHASE_BOUNDS[i][0], endSec: PHASE_BOUNDS[i][1], cx, cy, r });
  }
  return rings;
}

export const ringPhases: RingPhase[] = buildRingPhases();

export type GameEvent = {
  t: number;
  type: "kill" | "knock" | "ring" | "care" | "wipe";
  team?: string;
  label: string;
};

export const events: GameEvent[] = [
  { t: 38,   type: "ring",  label: "Ring 1 closing" },
  { t: 142,  type: "kill",  team: "TSM",  label: "TSM eliminates OXG player" },
  { t: 215,  type: "knock", team: "DZ",   label: "DarkZero knock on C9" },
  { t: 260,  type: "ring",  label: "Ring 2 closing" },
  { t: 388,  type: "wipe",  team: "TSM",  label: "TSM wipes 100T" },
  { t: 510,  type: "care",  label: "Care package dropped" },
  { t: 612,  type: "kill",  team: "SEN",  label: "Sentinels triple kill" },
  { t: 730,  type: "ring",  label: "Ring 3 closing" },
  { t: 845,  type: "wipe",  team: "DZ",   label: "DarkZero wipes FA" },
  { t: 980,  type: "kill",  team: "NRG",  label: "NRG eliminates LG" },
  { t: 1080, type: "ring",  label: "Ring 4 closing" },
  { t: 1210, type: "wipe",  team: "TSM",  label: "TSM wipes MV — endgame" },
];
