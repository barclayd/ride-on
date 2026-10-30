// Route identity colours (design/gen/proto-logic.js): twelve hues, one per shortlist place, so every
// shortlisted route is easy to tell apart. The map stays light, so its lines use these light values in
// both themes; panels will use var(--route-n), lifted for dark mode.
export const HUES = [
  '#026fd7',
  '#fd7306',
  '#a30362',
  '#07bba4',
  '#935f05',
  '#a989ff',
  '#7704aa',
  '#eb3067',
  '#088963',
  '#942300',
  '#0695b5',
  '#ff7c8a',
];
/** Library routes that aren't on the shortlist. */
export const UNSCORED = '#8e8e93';

/**
 * Each shortlisted route keeps its slot for as long as it stays shortlisted, and a newcomer takes the
 * lowest free one. With no history, slots follow shortlist order.
 */
export const assignSlots = (
  shortlist: readonly string[],
  previous: Readonly<Record<string, number>>,
) => {
  const slots = new Map<string, number>();
  const used = new Set<number>();
  for (const id of shortlist) {
    const slot = previous[id];
    if (
      Number.isInteger(slot) &&
      slot !== undefined &&
      slot >= 0 &&
      slot < HUES.length &&
      !used.has(slot)
    ) {
      slots.set(id, slot);
      used.add(slot);
    }
  }
  for (const id of shortlist) {
    if (slots.has(id)) continue;
    const free = HUES.findIndex((_, slot) => !used.has(slot));
    if (free < 0) break;
    slots.set(id, free);
    used.add(free);
  }
  return slots;
};

// The API keeps only the shortlist's order, so the slots live in this browser. Sign-out clears them.
const key = 'ride-on:route-slots';

const stored = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}');
  } catch {
    return {};
  }
};

/** In a swap, the route coming in takes the outgoing route's slot. Call it before `routeSlots`. */
export const handOver = (from: string, to: string) => {
  const { [from]: slot, ...rest } = stored();
  try {
    localStorage.setItem(key, JSON.stringify({ ...rest, [to]: slot }));
  } catch {}
};

/** The shortlist's slots, reconciled with the ones this browser last showed. */
export const routeSlots = (shortlist: readonly string[]) => {
  const slots = assignSlots(shortlist, stored());
  try {
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(slots)));
  } catch {}
  return slots;
};
