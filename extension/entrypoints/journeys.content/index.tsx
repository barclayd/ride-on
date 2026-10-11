import { type ComponentChildren, render } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { fetchJourney, fetchJourneyGpx } from '../../lib/cycletravel';
import { send } from '../../lib/state';
import { MAX_TRACKED, type RouteSummary } from '../../lib/types';
import {
  Banners,
  CoverageWarn,
  chooseWindow,
  ErrorChip,
  iconUrl,
  injectFonts,
  RideCard,
  reducedMotion,
  riddenFor,
  Tags,
  useView,
} from '../../ui/components';
import { buildResults, longWeekday } from '../../ui/format';
import css from '../../ui/tokens.css?inline';

type Row = {
  id: string;
  element: HTMLElement;
  mount: HTMLElement;
  tags: HTMLElement;
};

// Styles that must live on the page itself: host layout and the tracked-row edge.
const PAGE_CSS = `ride-on-module{display:block}
ride-on-chip{flex:none;align-self:center}
li.journey_row[data-ride-on-tracked]{box-shadow:inset 3px 0 0 #8bc61f}
ride-on-tags{display:none}
li.journey_row[data-ride-on-ridden] .journey_name{flex:0 1 auto}
li.journey_row[data-ride-on-ridden] ride-on-tags{display:block;flex:1 1 8rem;align-self:center}`;

const shadowMount = (host: HTMLElement) => {
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const mount = document.createElement('div');
  mount.className = 'ro-root';
  root.append(style, mount);
  return mount;
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong.';

const CHIP_STATES = new Set(['below', 'nofit', 'incomplete']);

const Tick = () => (
  <svg width="18" height="18" viewBox="0 0 14 14" aria-hidden="true">
    <circle cx="7" cy="7" r="7" fill="#7ba62a" />
    <path
      d="M4 7.2l2 2 4-4.4"
      fill="none"
      stroke="#fff"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

const Page = ({ rows }: { rows: Row[] }) => {
  const view = useView();
  const [busy, setBusy] = useState(new Set<string>());
  const [notice, setNotice] = useState<string | null>(null);
  const synced = useRef(false);
  // Once the window has passed, picking new dates confirms in the strip until the page is next loaded.
  const passed = useRef(false);
  const asked = useRef<ComponentChildren>(null); // the expired half, frozen while it fades out
  const [ranked, setRanked] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const before = useRef(new Map<string, DOMRect>());
  const signedIn = view?.state.auth === 'signed-in';
  const routes = view?.state.routes ?? {};
  const tracked = new Map<string, string>();
  for (const routeId of view?.state.selection?.routeIds ?? []) {
    const externalId = routes[routeId]?.source?.externalId;
    if (externalId) tracked.set(externalId, routeId);
  }
  // Ride tags show on any route Ride On knows, tracked or not.
  const known = new Map(
    Object.values(routes).flatMap((route) =>
      route.source ? [[route.source.externalId, route.id] as const] : [],
    ),
  );
  const ridden = (externalId: string) => {
    const routeId = known.get(externalId);
    const ride = view && routeId ? riddenFor(view, routeId) : null;
    return ride && (ride.today || ride.last) ? routeId : undefined;
  };

  useEffect(() => {
    for (const row of rows)
      row.element.toggleAttribute(
        'data-ride-on-tracked',
        signedIn && tracked.has(row.id),
      );
    for (const row of rows)
      row.element.toggleAttribute(
        'data-ride-on-ridden',
        signedIn && !!ridden(row.id),
      );
  });

  // Tracked journeys edited on cycle.travel since their last import get re-imported.
  useEffect(() => {
    if (!signedIn || !view || synced.current) return;
    synced.current = true;
    (async () => {
      const seen = ((await browser.storage.local.get('seen')).seen ??
        {}) as Record<string, number>;
      for (const externalId of tracked.keys()) {
        const journey = await fetchJourney(externalId);
        if (seen[externalId] === journey.updated_at) continue;
        const gpx = await fetchJourneyGpx(externalId, journey);
        const result = await send({
          type: 'import',
          journey: gpx,
          track: false,
        });
        if (result.error) throw new Error(result.error);
      }
    })().catch((error) =>
      setNotice(`Couldn't refresh routes: ${errorText(error)}`),
    );
  });

  if (view && !view.range) passed.current = true;
  const phase = !view?.range
    ? 'expired'
    : passed.current
      ? 'confirmed'
      : 'normal';
  const recs = view?.state.recs;
  const fresh =
    !!view?.range &&
    !view.state.loading &&
    recs?.range?.start === view.range[0] &&
    recs.range.end === view.range[1];
  // Placeholders until the new dates' scores arrive, so nothing old flashes up.
  const blank =
    phase === 'expired' || (phase === 'confirmed' && !ranked && !fresh);
  const reduce = reducedMotion();

  // The scores fade in, then the tiles move into ranked order.
  useEffect(() => {
    if (phase !== 'confirmed' || blank || ranked) return;
    const timer = setTimeout(
      () => {
        for (const tile of grid.current?.querySelectorAll<HTMLElement>(
          '.ro-ride',
        ) ?? [])
          before.current.set(
            tile.dataset.route ?? '',
            tile.getBoundingClientRect(),
          );
        setRanked(true);
      },
      reduce ? 0 : 750,
    );
    return () => clearTimeout(timer);
  }, [phase, blank, ranked, reduce]);

  // FLIP: each tile slides from where it was; those moving forward pass over the rest.
  useLayoutEffect(() => {
    if (!ranked || reduce) return;
    const old = [...before.current.keys()];
    const tiles = grid.current?.querySelectorAll<HTMLElement>('.ro-ride') ?? [];
    tiles.forEach((tile, i) => {
      const id = tile.dataset.route ?? '';
      const from = before.current.get(id);
      if (!from) return;
      const to = tile.getBoundingClientRect();
      const [dx, dy] = [from.left - to.left, from.top - to.top];
      if (!dx && !dy) return;
      tile.style.zIndex = i < old.indexOf(id) ? '2' : '1';
      tile.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 700, easing: 'cubic-bezier(.65,0,.25,1)' },
      ).onfinish = () => {
        tile.style.zIndex = '';
      };
    });
    before.current.clear();
  }, [ranked, reduce]);

  if (!view) return null;
  if (!signedIn)
    return (
      <div class="ro-strip">
        <img src={iconUrl()} alt="" />
        <div class="ro-strip-text">
          <span>Tracked routes</span>
          <span>
            Sign in to Ride On to track rides and get weather-matched times.
          </span>
        </div>
        <button
          type="button"
          class="ro-primary"
          onClick={() => send({ type: 'openPopup', tab: 'when' })}
        >
          Sign in
        </button>
      </div>
    );

  const toggle = async (externalId: string) => {
    const routeId = tracked.get(externalId);
    setNotice(null);
    setBusy((current) => new Set(current).add(externalId));
    try {
      const result = routeId
        ? await send({ type: 'untrack', routeId })
        : await send({
            type: 'import',
            journey: await fetchJourneyGpx(externalId),
            track: true,
          });
      if (result.error) setNotice(result.error);
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(externalId);
        return next;
      });
    }
  };

  const count = tracked.size;
  const full = count >= MAX_TRACKED;
  const cardByRoute = new Map(view.cards.map((card) => [card.routeId, card]));
  const routeIds = view.state.selection?.routeIds ?? [];
  // Blank tiles in tracked order; after new dates, scores fill in place before the ranked move.
  const cards = blank
    ? buildResults(routeIds, routes, null, [], view.timeZone).cards
    : phase === 'confirmed' && !ranked && !reduce
      ? routeIds.flatMap((id) => cardByRoute.get(id) ?? [])
      : view.cards;
  const href = (route: RouteSummary | undefined) =>
    route?.source ? `/map/journey/${route.source.externalId}` : '';
  const openWhen = () => send({ type: 'openPopup', tab: 'when' });
  const time = view.state.expired?.time ?? view.state.planning.time;
  const daylight = time.mode === 'daylight';
  const windowText = `${view.datesText} · ${daylight ? 'Daylight hours' : view.timeText}`;
  // Tomorrow and the same weekday next week, at the passed window's times; the API leaves out what the forecast doesn't cover.
  const suggestions = (view.state.next?.windows ?? []).filter(
    (w) => w.kind !== 'best_next_days',
  );

  if (phase === 'expired')
    asked.current = (
      <>
        <div class="ro-passed-text">
          <span>Pick new dates to see scores</span>
          <span>
            {view.datesText}, {daylight ? 'daylight hours' : view.timeText} has
            passed.
          </span>
        </div>
        <div class="ro-passed-actions">
          {suggestions.map((w) => (
            <button
              key={w.kind}
              type="button"
              class={w.kind === 'tomorrow' ? 'ro-primary' : 'ro-secondary'}
              onClick={() => chooseWindow(view, w)}
            >
              {w.kind === 'tomorrow'
                ? 'Tomorrow'
                : `Next ${longWeekday(w.date)}`}
            </button>
          ))}
          <button type="button" class="ro-link" onClick={openWhen}>
            Other dates
          </button>
        </div>
      </>
    );

  return (
    <section class="ro-module" aria-label="Tracked routes">
      <div class="ro-module-head">
        <div class="ro-module-title">
          <span>Tracked routes</span>
          <span>
            {count} / {MAX_TRACKED}
          </span>
        </div>
        <div class="ro-module-actions">
          <ErrorChip view={view} />
          {notice && (
            <span class="ro-warn-chip" role="status">
              {notice}
            </span>
          )}
          {phase === 'normal' && (
            <button type="button" class="ro-window" onClick={openWhen}>
              {windowText}
            </button>
          )}
        </div>
      </div>
      {phase !== 'normal' && (
        <div class="ro-passed" data-phase={phase}>
          <div aria-hidden={phase !== 'expired'} inert={phase !== 'expired'}>
            {asked.current}
          </div>
          <div
            aria-hidden={phase !== 'confirmed'}
            inert={phase !== 'confirmed'}
          >
            <Tick />
            <div class="ro-passed-text">
              <span>Scores updated</span>
              <span>{windowText}</span>
            </div>
            <button type="button" class="ro-link" onClick={openWhen}>
              Change dates
            </button>
          </div>
        </div>
      )}
      <Banners
        view={view}
        onProvider={() => send({ type: 'openPopup', tab: 'prefs' })}
      />
      {cards.length > 0 && (
        <div
          ref={grid}
          class="ro-grid ro-loading"
          data-loading={view.state.loading && !blank}
        >
          {cards.map((card, i) => (
            <RideCard
              key={card.routeId}
              view={view}
              card={card}
              href={href(routes[card.routeId])}
              blank={blank}
              index={i}
            />
          ))}
        </div>
      )}
      <CoverageWarn view={view} />
      {/* ponytail: weather attribution is popup-only by choice, though the cards show weather. */}
      {rows.map((row) => {
        const routeId = ridden(row.id);
        return (
          routeId &&
          createPortal(
            <div class="ro-tags">
              <Tags view={view} routeId={routeId} />
            </div>,
            row.tags,
          )
        );
      })}
      {rows.map((row) => {
        const routeId = tracked.get(row.id);
        const card = routeId && cardByRoute.get(routeId);
        const working = busy.has(row.id);
        return createPortal(
          routeId ? (
            <button
              type="button"
              class="ro-chip ro-tracked"
              data-state={
                !blank && card && CHIP_STATES.has(card.state)
                  ? card.state
                  : 'meets'
              }
              title="Stop tracking"
              disabled={working}
              onClick={() => toggle(row.id)}
            >
              {blank
                ? view.range
                  ? 'Checking…'
                  : 'Tracked'
                : card
                  ? card.chip
                  : 'Checking…'}
            </button>
          ) : (
            <button
              type="button"
              class="ro-chip"
              disabled={working || full}
              onClick={() => toggle(row.id)}
            >
              {working ? 'Adding…' : full ? `Limit ${MAX_TRACKED}` : '+ Track'}
            </button>
          ),
          row.mount,
        );
      })}
    </section>
  );
};

export default defineContentScript({
  matches: ['https://cycle.travel/user/journeys*'],
  main(ctx) {
    const toolbar = document.querySelector('.toolbar');
    const header = document.querySelector('header.page_header');
    if (!toolbar && !header) return;
    const pageStyle = document.createElement('style');
    pageStyle.textContent = PAGE_CSS;
    document.head.append(pageStyle);

    // Between the folders and the sort tabs, per the design.
    const moduleHost = document.createElement('ride-on-module');
    if (toolbar) toolbar.before(moduleHost);
    else header?.after(moduleHost);
    const added: Element[] = [injectFonts(), pageStyle, moduleHost];
    const rows = [
      ...document.querySelectorAll<HTMLElement>('li.journey_row'),
    ].map((element) => {
      const host = document.createElement('ride-on-chip');
      const meta = element.querySelector('.journey_meta');
      if (meta) meta.before(host);
      else element.append(host);
      const tags = document.createElement('ride-on-tags');
      const name = element.querySelector('a.journey_name');
      if (name) name.after(tags);
      else host.before(tags);
      added.push(host, tags);
      return {
        id: element.id.replace(/^jr_/, ''),
        element,
        mount: shadowMount(host),
        tags: shadowMount(tags),
      };
    });
    const mount = shadowMount(moduleHost);
    render(<Page rows={rows} />, mount);
    send({ type: 'refresh' });
    // Safari injects again into open pages (on enable, on site access), and WXT then invalidates
    // the older copy: it takes its UI with it, so only the newest shows.
    ctx.onInvalidated(() => {
      render(null, mount);
      for (const { element } of rows) {
        element.removeAttribute('data-ride-on-tracked');
        element.removeAttribute('data-ride-on-ridden');
      }
      for (const element of added) element.remove();
    });
  },
});
