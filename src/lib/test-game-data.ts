/**
 * Гидрация Test-матча (m-test, game 1) реальными данными из hud_read.
 * Источники в src/data/m-test-g1/ обновляются скриптом sync_to_ui.py.
 */
import elimRaw from "@/data/m-test-g1/eliminations.json";
import ringsRaw from "@/data/m-test-g1/rings.json";
import ringsV2Raw from "@/data/m-test-g1/ring_geometry_v2.json";
import slotToTagRaw from "@/data/m-test-g1/slot-to-tag.json";
import tracksRaw from "@/data/m-test-g1/tracks.json";
import hudTimelineRaw from "@/data/m-test-g1/hud_timeline.json";
import type { GameEvent, RingPhase, Team } from "./mock-match";
import { SLOT_COLORS } from "./team-colors";

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
type RingsFile = {
  fps: number;
  phases: RingPhaseRaw[];
};
type RingGeomV2Phase = {
  ring: number;
  cx_canon_norm?: number;
  cy_canon_norm?: number;
  r_canon_norm?: number;
  geometry_confidence?: string;
  samples?: number;
};
type RingsV2File = {
  canonical?: string;
  canonical_size?: [number, number];
  phases?: RingGeomV2Phase[];
};

function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const MTEST_LS_KEYS = {
  tracks: "mtest:tracks",
  rings: "mtest:rings",
  ringsV2: "mtest:ringsV2",
  eliminations: "mtest:eliminations",
  slotToTag: "mtest:slotToTag",
  hudTimeline: "mtest:hudTimeline",
} as const;

// HUD timeline теперь содержит встроенный блок `eliminations` — это
// единый источник истины для HUD-смертей. Отдельный eliminations.json
// остаётся только как fallback для старых выгрузок.
type HudTimelineFile = {
  eliminations?: { teams?: Record<string, ElimTeam> };
};
const hudTimeline = lsGet(
  MTEST_LS_KEYS.hudTimeline,
  hudTimelineRaw as unknown as HudTimelineFile,
);
const elimStandalone = lsGet(
  MTEST_LS_KEYS.eliminations,
  elimRaw as unknown as ElimFile,
);
const elim: ElimFile = {
  fps: elimStandalone.fps,
  teams: hudTimeline.eliminations?.teams ?? elimStandalone.teams,
};
const rings = lsGet(MTEST_LS_KEYS.rings, ringsRaw as unknown as RingsFile);
const ringsV2 = lsGet(MTEST_LS_KEYS.ringsV2, ringsV2Raw as unknown as RingsV2File);
const slotToTag = lsGet(
  MTEST_LS_KEYS.slotToTag,
  slotToTagRaw as unknown as Record<string, string>,
);

// ── Tracks (track_teams pipeline) ───────────────────────────────────
type TrackPoint = {
  team_id: string;
  world: [number, number] | null;
  state: string;
  confidence: number;
};
type TrackFrame = { t: number; frame: number; tracks: TrackPoint[] };
type TracksFile = {
  meta: {
    canonical_size: [number, number];
    world_bounds: { x: [number, number]; y: [number, number] };
  };
  frames: TrackFrame[];
};
const tracks = lsGet(MTEST_LS_KEYS.tracks, tracksRaw as unknown as TracksFile);

/** Длительность игры — последний наблюдавшийся "жив". */
export const testGameDurationSec: number = Math.ceil(
  Object.values(elim.teams).reduce(
    (m, t) => Math.max(m, t.t_last_alive ?? 0),
    0,
  ),
);

/** Реальные траектории команд (нормализованные 0..1 от canonical-карты).
 *  Ключ — team.id из testGameTeams (`t-test-${slot_number}`). */
export const testGameTrajectories: Record<string, { t: number; x: number; y: number }[]> = (() => {
  const [W, H] = tracks.meta.canonical_size ?? [2048, 2048];
  const out: Record<string, { t: number; x: number; y: number }[]> = {};
  // SOURCE OF TRUTH для alive/dead — eliminations.json (HUD).
  // tracks.slots.json.wiped_at_t игнорируем: track_teams часто закрывает
  // живые команды по absence-fallback (см. логи). Точки трекаются
  // вплоть до t_first_dead из HUD (или до конца матча, если жива).
  const deadAt: Record<string, number> = {};
  for (const [slot, t] of Object.entries(elim.teams)) {
    if (t.t_first_dead != null) deadAt[`slot_${slot}`] = t.t_first_dead;
  }
  for (const fr of tracks.frames) {
    for (const tr of fr.tracks) {
      if (!tr.world) continue;
      // Не рисуем точки после реальной смерти по HUD.
      const dead = deadAt[tr.team_id];
      if (dead != null && fr.t > dead) continue;
      // Принимаем tracked + coast + hold + low_conf — это валидные позиции
      // (coast/low_conf = Kalman-extrapolation, ещё ок).
      // lost/wiped из track_teams отбрасываем — там нет world или он stale.
      if (tr.state === "lost" || tr.state === "wiped") continue;
      const slotNum = tr.team_id.replace(/^slot_/, "");
      const key = `t-test-${slotNum}`;
      const x = tr.world[0] / W;
      const y = tr.world[1] / H;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      (out[key] ??= []).push({ t: fr.t, x, y });
    }
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => a.t - b.t);
  }
  return out;
})();

export const testGameRingPhases: RingPhase[] = (() => {
  const closing = rings.phases
    .filter((p) => p.t_closing_start != null)
    .sort((a, b) => (a.ring - b.ring));

  if (closing.length === 0) return [];

  // Геометрия из ring_locator в координатах канонической карты
  // (storm_point.png 2048x2048). Поздние фазы без замера наследуют
  // последнее реальное кольцо — см. roadmap в модуле ring_locator.
  const geomByRing = new Map<number, RingGeomV2Phase>();
  for (const g of ringsV2.phases ?? []) {
    if (g.cx_canon_norm != null && g.cy_canon_norm != null && g.r_canon_norm != null
        && (g.samples ?? 0) >= 2) {
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
      cx = real.cx_canon_norm!;
      cy = real.cy_canon_norm!;
      r = real.r_canon_norm!;
      source = "real";
      lastReal = { cx, cy, r };
    } else if (lastReal) {
      // Нет геометрии для этой фазы — наследуем предыдущую реальную.
      cx = lastReal.cx;
      cy = lastReal.cy;
      r = lastReal.r;
      source = "inherited";
    } else {
      // До первого реального замера данных нет — фазу пропускаем.
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
      teamId: `t-test-${slot}`,
      slot: Number(slot),
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

/** Палитра цветов = HUD VOD по слотам (см. src/lib/team-colors.ts). */
const TEAM_PALETTE = SLOT_COLORS;

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
    // Цвет берём по slot (1..20), а не по порядку команд — чтобы плашка
    // совпадала с фишкой на карте и с HUD VOD.
    const slotIdx = Math.max(0, Number(slot) - 1);
    return {
      id: `t-test-${slot}`,
      tag,
      name: tag,
      color: TEAM_PALETTE[slotIdx % TEAM_PALETTE.length],
      players: [],
      placement: placementBySlot.get(slot) ?? Number(slot),
      kills: 0,
      alive: !dead,
    } satisfies Team;
  });
})();