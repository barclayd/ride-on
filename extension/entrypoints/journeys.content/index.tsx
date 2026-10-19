import { type ComponentChildren, render } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { fetchJourney, fetchJourneyGpx } from '../../lib/cycletravel';
import { send } from '../../lib/state';
import { surfaceSeenKey } from '../../lib/surface';
import { MAX_TRACKED, type RouteSummary } from '../../lib/types';
import { AlertsDialog } from '../../ui/alerts';
import {
  Banners,
  CoverageWarn,
  chooseWindow,
  EditButton,
  ErrorChip,
  iconUrl,
  injectFonts,
  PausedLine,
  Ranked,
  RouteTile,
  riddenFor,
  Tags,
  Toast,
  useTracking,
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

// Styles that must live on the page itself: host layout and the tracked-row edge. cycle.travel lines
// its rows up on the text baseline, which puts the name at the top of a row the chip makes taller;
// every row centres instead, and the chip slot keeps the chip's height (without the page's tall line
// height) so rows match with or without one.
const PAGE_CSS = `ride-on-module{display:block}
li.journey_row{align-items:center}
ride-on-chip{flex:none;display:flex;align-items:center;min-height:26px;line-height:0}
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

const CONFIRMED_MS = 4000;
const FADE_MS = 300;

const Page = ({ rows }: { rows: Row[] }) => {
  const view = useView(import.meta.env.SAFARI);
  const tracking = useTracking(view);
  const [busy, setBusy] = useState(new Set<string>());
  const [notice, setNotice] = useState<string | null>(null);
  const synced = useRef(false);
  // Once the window has passed, picking new dates confirms in the strip; it fades a few seconds after
  // the new scores arrive.
  const passed = useRef(false);
  const asked = useRef<ComponentChildren>(null); // the expired half, frozen while it fades out
  const filled = useRef(false); // the new dates' scores have arrived
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
        if (seen[surfaceSeenKey(externalId)] === journey.updated_at) continue;
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

  const paused = !!view?.paused;
  if (view && !view.range && !paused) passed.current = true;
  // Paused: no window, no scores, nothing passed (handoff v6 §4).
  const phase = paused
    ? 'paused'
    : !view?.range
      ? 'expired'
      : passed.current
        ? 'confirmed'
        : 'normal';
  const recs = view?.state.recs;
  const fresh =
    !!view?.range &&
    !view.state.loading &&
    JSON.stringify(recs?.range?.dates) === JSON.stringify(view.range);
  if (phase === 'confirmed' && fresh) filled.current = true;
  // Placeholders until the new dates' scores arrive, so nothing old flashes up; they then fill in place
  // and Ranked moves the tiles into order.
  const blank =
    phase === 'expired' || (phase === 'confirmed' && !filled.current);
  const [leaving, setLeaving] = useState(false);
  const settled = phase === 'confirmed' && filled.current;
  useEffect(() => {
    if (!settled) return;
    const fade = setTimeout(() => setLeaving(true), CONFIRMED_MS);
    const gone = setTimeout(() => {
      passed.current = false;
      filled.current = false;
      setLeaving(false);
    }, CONFIRMED_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [settled]);

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
  // Blank tiles in tracked order.
  const cards = blank
    ? buildResults(
        view.state.selection?.routeIds ?? [],
        routes,
        null,
        [],
        view.timeZone,
        view.state.units,
      ).cards
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
          {count > 0 && <EditButton tracking={tracking} />}
        </div>
      </div>
      {paused && <PausedLine view={view} />}
      {(phase === 'expired' || phase === 'confirmed') && (
        <div
          class="ro-passed"
          data-phase={phase}
          data-leaving={leaving || undefined}
        >
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
        <Ranked
          cards={cards}
          class="ro-grid"
          render={(card, i) => (
            <RouteTile
              key={card.routeId}
              view={view}
              card={card}
              href={href(routes[card.routeId])}
              blank={blank}
              index={i}
              tracking={tracking}
            />
          )}
        />
      )}
      <CoverageWarn view={view} />
      {(cards.length > 0 || tracking.said) && <Toast tracking={tracking} />}
      <AlertsDialog view={view} tracking={tracking} />
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
              class="ro-chip ro-chip-tracked"
              data-state={
                !blank && card && CHIP_STATES.has(card.state)
                  ? card.state
                  : 'meets'
              }
              title="Stop tracking"
              disabled={working}
              onClick={() => toggle(row.id)}
            >
              {paused
                ? 'Tracked'
                : blank
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
    // The background checks this after an update; a stale copy gets replaced. Not a message:
    // Safari often drops those to content scripts, and every live copy then looked dead.
    (globalThis as { rideOnAlive?: () => boolean }).rideOnAlive = () =>
      ctx.isValid;
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
