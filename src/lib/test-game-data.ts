/**
 * Гидрация Test-матча (m-test, game 1) реальными данными из hud_read.
 * Источники в src/data/m-test-g1/ обновляются скриптом sync_to_ui.py.
 */
import elimRaw from "@/data/m-test-g1/eliminations.json";
import ringsRaw from "@/data/m-test-g1/rings.json";
import slotToTagRaw from "@/data/m-test-g1/slot-to-tag.json";
import type { GameEvent, RingPhase, Team } from "./mock-match";

type ElimTeam = {
  f_first_dead: number | null;
  t_first_dead: number | null;
  f_last_alive: number | null;
  t_last_alive: number | null;
};
type ElimFile = { fps: number; teams: Record<string, ElimTeam> };
type RingPhaseRaw = {
  ring: number;
  countdown_start_f: number | null;
  t_countdown_start: number | null;
  closing_start_f: number | null;
  t_closing_start: number | null;
  closed_f: number | null;
  t_closed: number | null;
};
type RingGeomPhase = {
  ring: number;
  cx_norm: number | null;
  cy_norm: number | null;
  r_norm: number | null;
  cx_roi_px?: number | null;
  cy_roi_px?: number | null;
  r_roi_px?: number | null;
  roi_size?: [number, number];
  cx_map_norm?: number | null;
  cy_map_norm?: number | null;
  r_map_norm?: number | null;
  cx_zoom_norm?: number | null;
  cy_zoom_norm?: number | null;
  r_zoom_norm?: number | null;
  map_zoom?: number | null;
  geometry_confidence?: string;
};
type RingsFile = {
  fps: number;
  phases: RingPhaseRaw[];
  geometry?: {
    phases?: RingGeomPhase[];
    minimap?: [number, number, number, number];
    map_bounds_in_roi?: { x: number; y: number; w: number; h: number };
  };
};

const elim = elimRaw as unknown as ElimFile;
const rings = ringsRaw as unknown as RingsFile;
const slotToTag = slotToTagRaw as unknown as Record<string, string>;

/** Сырая геометрия для дебаг-оверлея (?debug=1). */
export const testGameRingGeometry = rings.geometry ?? null;

/** Длительность игры — последний наблюдавшийся "жив". */
export const testGameDurationSec: number = Math.ceil(
  Object.values(elim.teams).reduce(
    (m, t) => Math.max(m, t.t_last_alive ?? 0),
    0,
  ),
);

export const testGameRingPhases: RingPhase[] = (() => {
  const closing = rings.phases
    .filter((p) => p.t_closing_start != null)
    .sort((a, b) => (a.ring - b.ring));

  if (closing.length === 0) return [];

  // Если есть реальная геометрия из ring_locator — берём её, иначе
  // падаем на mock RING_OFFSETS, чтобы хоть что-то рисовать.
  const geomByRing = new Map<number, RingGeomPhase>();
  for (const g of rings.geometry?.phases ?? []) {
    if (g.cx_norm != null && g.cy_norm != null && g.r_norm != null) {
      geomByRing.set(g.ring, g);
    }
  }

  const out: RingPhase[] = [];
  let lastReal: { cx: number; cy: number; r: number } | null = null;
  for (let i = 0; i < closing.length; i++) {
    const ringN = closing[i].ring;
    const real = geomByRing.get(ringN);
    let cx: number, cy: number, r: number;
    let source: "real" | "inherited";
    if (real) {
      cx = real.cx_zoom_norm ?? real.cx_map_norm ?? real.cx_norm!;
      cy = real.cy_zoom_norm ?? real.cy_map_norm ?? real.cy_norm!;
      r = real.r_zoom_norm ?? real.r_map_norm ?? real.r_norm!;
      source = "real";
      lastReal = { cx, cy, r };
    } else if (lastReal) {
      // Нет геометрии для этой фазы — наследуем предыдущую реальную
      // (не выдумываем смещение моком). Кольцо «стоит на месте» до
      // следующего реального замера.
      cx = lastReal.cx;
      cy = lastReal.cy;
      r = lastReal.r;
      source = "inherited";
    } else {
      // До первого реального замера данных нет — фазу пропускаем,
      // чтобы не рисовать произвольное кольцо.
      continue;
    }
    const cur = closing[i];
    const next = closing[i + 1];
    const prev = closing[i - 1];
    const startSec = cur.t_countdown_start
      ?? (i === 0 ? 0 : (prev?.t_closing_start ?? 0));
    const closingStartSec = cur.t_closing_start ?? undefined;
    const endSec = i === closing.length - 1
      ? testGameDurationSec
      : (next?.t_countdown_start ?? next?.t_closing_start ?? testGameDurationSec);
    out.push({ startSec, endSec, closingStartSec, cx, cy, r, source });
  }
  return out;
})();

export const testGameEvents: GameEvent[] = (() => {
  const out: GameEvent[] = [];
  // Eliminations
  for (const [slot, t] of Object.entries(elim.teams)) {
    if (t.t_first_dead == null) continue;
    const tag = slotToTag[slot] ?? `T${slot}`;
    out.push({
      t: Math.round(t.t_first_dead),
      type: "wipe",
      team: tag,
      label: `${tag} eliminated`,
    });
  }
  // Ring transitions
  for (const p of rings.phases) {
    if (p.t_closing_start != null && p.ring >= 1) {
      out.push({
        t: Math.round(p.t_closing_start),
        type: "ring",
        label: `Ring ${p.ring} closing`,
      });
    }
  }
  // Endgame
  out.push({
    t: testGameDurationSec,
    type: "endgame",
    label: "Game ended",
  });
  return out.sort((a, b) => a.t - b.t);
})();

/** Палитра цветов для команд из реального матча. */
const TEAM_PALETTE = [
  "#ff5b12", "#22c4f5", "#ffd23f", "#e879f9", "#a78bfa",
  "#fb923c", "#60a5fa", "#f87171", "#86efac", "#38bdf8",
  "#34d399", "#facc15", "#fca5a5", "#fde68a", "#22d3ee",
  "#f472b6", "#84cc16", "#c084fc", "#fb7185", "#5eead4",
];

export const testGameTeams: Team[] = (() => {
  const slots = Object.keys(elim.teams).sort((a, b) => Number(a) - Number(b));
  // Placement: команда жива → 1; иначе чем позже погибли, тем выше место.
  const ranked = [...slots].sort((a, b) => {
    const ta = elim.teams[a].t_first_dead;
    const tb = elim.teams[b].t_first_dead;
    if (ta == null && tb == null) return 0;
    if (ta == null) return -1;
    if (tb == null) return 1;
    return tb - ta;
  });
  const placementBySlot = new Map<string, number>();
  ranked.forEach((slot, i) => placementBySlot.set(slot, i + 1));

  return slots.map((slot, idx) => {
    const tag = slotToTag[slot] ?? `T${slot}`;
    const dead = elim.teams[slot].t_first_dead != null;
    return {
      id: `t-test-${slot}`,
      tag,
      name: tag,
      color: TEAM_PALETTE[idx % TEAM_PALETTE.length],
      players: [],
      placement: placementBySlot.get(slot) ?? Number(slot),
      kills: 0,
      alive: !dead,
    } satisfies Team;
  });
})();