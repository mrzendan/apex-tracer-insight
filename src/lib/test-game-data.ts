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
type RingsFile = { fps: number; phases: RingPhaseRaw[] };

const elim = elimRaw as unknown as ElimFile;
const rings = ringsRaw as unknown as RingsFile;
const slotToTag = slotToTagRaw as unknown as Record<string, string>;

/** Геометрия колец — пока mock (нужен minimap-locator для реальной). */
const RING_OFFSETS: { fx: number; fy: number }[] = [
  { fx: 0.0,  fy: 0.0  },
  { fx: 0.35, fy: -0.2 },
  { fx: -0.3, fy: 0.25 },
  { fx: 0.2,  fy: 0.3  },
  { fx: -0.25,fy: -0.15},
  { fx: 0.15, fy: 0.1  },
];

/** Длительность игры — последний наблюдавшийся "жив". */
export const testGameDurationSec: number = Math.ceil(
  Object.values(elim.teams).reduce(
    (m, t) => Math.max(m, t.t_last_alive ?? 0),
    0,
  ),
);

export const testGameRingPhases: RingPhase[] = (() => {
  // Соберём опорные тайминги начала закрытия каждой фазы.
  const closing = rings.phases
    .filter((p) => p.t_closing_start != null)
    .sort((a, b) => (a.ring - b.ring));

  if (closing.length === 0) return [];

  // startSec фазы N = t_closing_start фазы N-1 (или 0 для первой).
  // endSec фазы N = t_closing_start фазы N+1 (или duration для последней).
  const out: RingPhase[] = [];
  let cx = 0.5, cy = 0.5, r = 0.46;
  for (let i = 0; i < closing.length; i++) {
    if (i > 0) {
      const parent = out[i - 1];
      const off = RING_OFFSETS[i] ?? { fx: 0, fy: 0 };
      r = parent.r / 2;
      cx = parent.cx + parent.r * off.fx;
      cy = parent.cy + parent.r * off.fy;
    }
    const startSec = i === 0 ? 0 : (closing[i - 1].t_closing_start ?? 0);
    const endSec = i === closing.length - 1
      ? testGameDurationSec
      : (closing[i].t_closing_start ?? testGameDurationSec);
    out.push({ startSec, endSec, cx, cy, r });
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