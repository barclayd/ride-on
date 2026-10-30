import { expect, test } from 'bun:test';
import { assignSlots, HUES } from './slots.ts';

const slots = (shortlist: string[], previous: Record<string, number> = {}) =>
  Object.fromEntries(assignSlots(shortlist, previous));

test('with no history, slots follow shortlist order', () => {
  expect(slots(['a', 'b', 'c'])).toEqual({ a: 0, b: 1, c: 2 });
});

test('a route keeps its slot while shortlisted, and a newcomer takes the lowest free one', () => {
  // b was removed, so its slot is free for d; c keeps 2 although it's now second.
  expect(slots(['a', 'c', 'd'], { a: 0, b: 1, c: 2 })).toEqual({
    a: 0,
    c: 2,
    d: 1,
  });
});

test('a swapped-in route inherits the slot handed over to it', () => {
  // The swap (design/gen/proto-logic.js) writes the outgoing slot to the incoming route.
  expect(slots(['a', 'x', 'c'], { a: 0, x: 1, c: 2 })).toEqual({
    a: 0,
    x: 1,
    c: 2,
  });
});

test('clashing or nonsense slots from storage are reassigned', () => {
  expect(slots(['a', 'b', 'c'], { a: 4, b: 4, c: 99 })).toEqual({
    a: 4,
    b: 0,
    c: 1,
  });
  expect(slots(['a'], { a: 1.5 })).toEqual({ a: 0 });
});

test('twelve routes fill every hue once', () => {
  const twelve = HUES.map((_, i) => `r${i}`);
  expect(new Set(Object.values(slots(twelve))).size).toBe(HUES.length);
});
