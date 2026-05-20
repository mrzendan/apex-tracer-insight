/**
 * Гидрация Test-матча (m-test, game 1) реальными данными из hud_read.
 * Источники в src/data/m-test-g1/ обновляются скриптом sync_to_ui.py.
 */
import elimRaw from "@/data/m-test-g1/eliminations.json";
import ringsRaw from "@/data/m-test-g1/rings.json";
import slotToTagRaw from "@/data/m-test-g1/slot-to-tag.json";
import type { GameEvent, RingPhase } from "./mock-match";

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