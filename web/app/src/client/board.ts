import { TypedEventTarget } from 'remix/component';
import {
  api,
  get,
  type Library,
  loadLibrary,
  type Selection,
} from './library.ts';
import { handOver, routeSlots } from './slots.ts';
import { MAX, type Recommendations } from './view.ts';

type Swap = { add: string; out: string };
const json = { 'Content-Type': 'application/json' };

/**
 * The signed-in screen's state: the library, the shortlist and its scores. The panel, its overlays and
 * the map all use this one instance (Bun puts it in a chunk they share). Events: `change` for any
 * change, `shortlist` when the map has to recolour, `hover` when a route is pointed at.
 */
class Board extends TypedEventTarget<{
  change: Event;
  shortlist: Event;
  hover: Event;
}> {
  library: Library | null = null;
  failed = false;
  /** Shortlisted route ids, in the rider's order. */
  shortlist: string[] = [];
  /** Each shortlisted route's colour slot (client/slots.ts). */
  slots = new Map<string, number>();
  recs: Recommendations | null = null;
  /** A recommendations request is in flight. */
  asking = false;
  /** Shortlisted since the last answer, so they read "Checking the forecast…". */
  checking = new Set<string>();
  recsFailed = false;
  hovered: string | null = null;
  /** The full-shortlist sheet: the route going in and the one picked to make way. */
  pop: Swap | null = null;
  toast: { text: string; undo: boolean } | null = null;
  #version = 0;
  #loading: Promise<Library | null> | null = null;
  #writes = Promise.resolve();
  #queued = 0;
  #asked = 0;
  #undo: (Swap & { recs: Recommendations | null }) | null = null;
  #toastTimer: ReturnType<typeof setTimeout> | undefined;

  #emit(...types: ('change' | 'shortlist' | 'hover')[]) {
    for (const type of types) this.dispatchEvent(new Event(type));
  }

  name(id: string) {
    return this.library?.routes.find((route) => route.id === id)?.name ?? '';
  }

  /** Loads the library once, then scores the shortlist. */
  load() {
    this.#loading ??= loadLibrary().then(
      (library) => {
        this.library = library;
        this.#version = library.version;
        this.#setShortlist(library.shortlist);
        this.#emit('change');
        this.#recommend();
        return library;
      },
      (error) => {
        console.warn('Ride On: no library', error);
        this.failed = true;
        this.#emit('change');
        return null;
      },
    );
    return this.#loading;
  }

  #setShortlist(ids: string[]) {
    this.shortlist = ids;
    this.slots = routeSlots(ids);
    this.#emit('shortlist');
  }

  /**
   * Shows the change at once, then saves it. `edit` applies it to a list, so after a 409 it can be
   * applied again to the newer list on the server. `recs`, from an undo, restores the scores the
   * old list had instead of asking again.
   */
  #commit(edit: (ids: string[]) => string[], recs?: Recommendations | null) {
    const before = new Set(this.shortlist);
    this.#setShortlist(edit(this.shortlist));
    if (recs === undefined) {
      for (const id of this.shortlist)
        if (!before.has(id)) this.checking.add(id);
      this.#recommend();
    } else {
      this.#asked++;
      this.asking = false;
      this.recs = recs;
      this.checking.clear();
      this.#emit('change');
    }
    this.#queued++;
    this.#writes = this.#writes
      .then(() => this.#save(edit))
      .then(
        (saved) => {
          // A newer list from the server (another device) wins once nothing else is queued.
          if (--this.#queued || saved.join() === this.shortlist.join()) return;
          const ids = new Set(this.library?.routes.map((route) => route.id));
          this.#setShortlist(saved.filter((id) => ids.has(id)));
          this.#recommend();
        },
        async (error) => {
          this.#queued--;
          console.warn('Ride On: shortlist not saved', error);
          this.#showToast("Couldn't save your shortlist", false);
          const { selection } = await get<{ selection: Selection }>(
            '/api/route-selection',
          ).catch(() => ({ selection: null }));
          if (!selection || this.#queued) return;
          this.#version = selection.version;
          this.#setShortlist(selection.routeIds);
          this.#recommend();
        },
      );
  }

  async #save(edit: (ids: string[]) => string[]) {
    const put = (routeIds: string[]) =>
      api('/api/route-selection', {
        method: 'PUT',
        headers: json,
        body: JSON.stringify({ expectedVersion: this.#version, routeIds }),
      });
    let response = await put(this.shortlist);
    if (response.status === 409) {
      const { selection } = await get<{ selection: Selection }>(
        '/api/route-selection',
      );
      this.#version = selection.version;
      response = await put(edit(selection.routeIds));
    }
    if (!response.ok)
      throw new Error(`route-selection answered ${response.status}`);
    const { selection } = (await response.json()) as { selection: Selection };
    this.#version = selection.version;
    return selection.routeIds;
  }

  /** Scores the current shortlist. Only the latest answer counts. */
  async #recommend() {
    const asked = ++this.#asked;
    const routeIds = [...this.shortlist];
    this.recsFailed = false;
    if (!routeIds.length) {
      this.asking = false;
      this.recs = null;
      this.checking.clear();
      this.#emit('change');
      return;
    }
    this.asking = true;
    this.#emit('change');
    try {
      const response = await api('/api/recommendations', {
        method: 'POST',
        headers: json,
        // ponytail: today to today+4 until the day strip (2.3) asks for its 7-day range.
        body: JSON.stringify({
          routeIds,
          days: { kind: 'preset', preset: 'next' },
        }),
      });
      if (!response.ok)
        throw new Error(`recommendations answered ${response.status}`);
      const recs = (await response.json()) as Recommendations;
      if (asked !== this.#asked) return;
      this.recs = recs;
      this.checking.clear();
    } catch (error) {
      if (asked !== this.#asked) return;
      console.warn('Ride On: no recommendations', error);
      this.recsFailed = true;
    }
    this.asking = false;
    this.#emit('change');
  }

  /** Adds a library route; with a full shortlist, asks which route makes way. */
  add(id: string) {
    if (this.shortlist.includes(id)) return;
    if (this.shortlist.length < MAX) {
      this.#commit((ids) =>
        ids.includes(id) || ids.length >= MAX ? ids : [...ids, id],
      );
      return;
    }
    this.pop = { add: id, out: this.#lowest() };
    this.#emit('change');
  }

  /** The suggestion to swap out: a route without a score, or else the lowest score. */
  #lowest() {
    const score = (id: string) =>
      this.recs?.rankings.find((r) => r.routeId === id)?.best?.score ??
      -Infinity;
    return this.shortlist.reduce((low, id) =>
      score(id) < score(low) ? id : low,
    );
  }

  choose(out: string) {
    if (!this.pop) return;
    this.pop = { ...this.pop, out };
    this.#emit('change');
  }

  cancel() {
    this.pop = null;
    this.#emit('change');
  }

  /** The incoming route takes the outgoing route's place and colour. */
  swap() {
    if (!this.pop) return;
    const { add, out } = this.pop;
    this.pop = null;
    this.#undo = { add, out, recs: this.recs };
    handOver(out, add);
    this.#commit((ids) =>
      ids.includes(add) ? ids : ids.map((id) => (id === out ? add : id)),
    );
    this.#showToast(`${this.name(out)} moved to your library`, true);
  }

  undo() {
    const undo = this.#undo;
    if (!undo) return;
    this.#undo = null;
    this.toast = null;
    handOver(undo.add, undo.out);
    this.#commit(
      (ids) =>
        ids.includes(undo.out)
          ? ids
          : ids.map((id) => (id === undo.add ? undo.out : id)),
      undo.recs,
    );
  }

  #showToast(text: string, undo: boolean) {
    clearTimeout(this.#toastTimer);
    this.toast = { text, undo };
    if (!undo) this.#undo = null;
    this.#emit('change');
    this.#toastTimer = setTimeout(() => {
      this.toast = null;
      this.#undo = null;
      this.#emit('change');
    }, 5000);
  }

  hover(id: string | null) {
    if (id === this.hovered) return;
    this.hovered = id;
    this.#emit('hover', 'change');
  }
}

export const board = new Board();
