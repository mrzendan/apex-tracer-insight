/**
 * Slot-based team colors.
 * RULE: A team has NO fixed color. On the map page (and only there), each team
 * gets a color based on its slot index (1..20) within the match. Slot colors
 * are taken from the reference palette below (HEX from the team-color table).
 */

export const SLOT_COLORS: readonly string[] = [
  "#078396", // 1
  "#1B486A", // 2
  "#1F55CD", // 3
  "#452A60", // 4
  "#6E2C70", // 5
  "#AD2D78", // 6
  "#AE1C51", // 7
  "#BF000B", // 8
  "#C34221", // 9
  "#791F14", // 10
  "#9F3A0D", // 11
  "#764B01", // 12
  "#CE7A12", // 13
  "#967E01", // 14
  "#84930A", // 15
  "#495903", // 16
  "#719844", // 17
  "#398935", // 18
  "#2F5B19", // 19
  "#017557", // 20
] as const;

/** Returns the slot color for a 0-based slot index. Wraps if out of range. */
export function getSlotColor(slotIndex: number): string {
  const i = ((slotIndex % SLOT_COLORS.length) + SLOT_COLORS.length) % SLOT_COLORS.length;
  return SLOT_COLORS[i];
}

/** Returns the slot label (e.g. "TEAM_1") for a 0-based slot index. */
export function getSlotLabel(slotIndex: number): string {
  return `TEAM_${slotIndex + 1}`;
}
