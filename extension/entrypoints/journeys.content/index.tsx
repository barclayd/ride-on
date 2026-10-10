import { render } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { fetchJourney, fetchJourneyGpx } from '../../lib/cycletravel';
import { send } from '../../lib/state';
import { MAX_TRACKED, type RouteSummary } from '../../lib/types';
import {
  Attribution,
  Banners,
  CoverageWarn,
  chooseAvailableDates,
  ErrorChip,
  Expired,
  iconUrl,
  injectFonts,
  RideCard,
  useView,
} from '../../ui/components';
import css from '../../ui/tokens.css?inline';

type Row = { id: string; element: HTMLElement; mount: HTMLElement };

// Styles that must live on the page itself: host layout and the tracked-row edge.
const PAGE_CSS = `ride-on-module{display:block}
ride-on-chip{flex:none;align-self:center}
li.journey_row[data-ride-on-tracked]{box-shadow:inset 3px 0 0 #8bc61f}`;

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

const Page = ({ rows }: { rows: Row[] }) => {
  const view = useView();
  const [busy, setBusy] = useState(new Set<string>());
  const [notice, setNotice] = useState<string | null>(null);
  const synced = useRef(false);
  const signedIn = view?.state.auth === 'signed-in';
  const routes = view?.state.routes ?? {};
  const tracked = new Map<string, string>();
  for (const routeId of view?.state.selection?.routeIds ?? []) {
    const externalId = routes[routeId]?.source?.externalId;
    if (externalId) tracked.set(externalId, routeId);
  }

  useEffect(() => {
    for (const row of rows)
      row.element.toggleAttribute(
        'data-ride-on-tracked',
        signedIn && tracked.has(row.id),
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

  const { cards } = view;
  const count = tracked.size;
  const full = count >= MAX_TRACKED;
  const cardByRoute = new Map(cards.map((card) => [card.routeId, card]));
  const href = (route: RouteSummary | undefined) =>
    route?.source ? `/map/journey/${route.source.externalId}` : '';
  const openWhen = () => send({ type: 'openPopup', tab: 'when' });

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
          <button
            type="button"
            class="ro-window"
            data-expired={!view.range}
            onClick={openWhen}
          >
            {view.range
              ? `${view.datesText} · ${view.timeText}`
              : 'Dates passed'}
          </button>
        </div>
      </div>
      {!view.range && (
        <Expired
          view={view}
          variant="page"
          onChoose={() => {
            chooseAvailableDates(view);
            openWhen();
          }}
        />
      )}
      <Banners view={view} />
      {cards.length > 0 && (
        <div class="ro-grid ro-loading" data-loading={view.state.loading}>
          {cards.map((card) => (
            <RideCard
              key={card.routeId}
              card={card}
              href={href(routes[card.routeId])}
            />
          ))}
        </div>
      )}
      <CoverageWarn view={view} />
      <Attribution view={view} />
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
                !view.range
                  ? 'below'
                  : card && CHIP_STATES.has(card.state)
                    ? card.state
                    : 'meets'
              }
              title="Stop considering"
              disabled={working}
              onClick={() => toggle(row.id)}
            >
              {!view.range ? 'Dates passed' : card ? card.chip : 'Checking…'}
            </button>
          ) : (
            <button
              type="button"
              class="ro-chip"
              disabled={working || full}
              onClick={() => toggle(row.id)}
            >
              {working
                ? 'Adding…'
                : full
                  ? `Limit ${MAX_TRACKED}`
                  : '+ Consider'}
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
  main() {
    const toolbar = document.querySelector('.toolbar');
    const header = document.querySelector('header.page_header');
    if (!toolbar && !header) return;
    injectFonts();
    const pageStyle = document.createElement('style');
    pageStyle.textContent = PAGE_CSS;
    document.head.append(pageStyle);

    // Between the folders and the sort tabs, per the design.
    const moduleHost = document.createElement('ride-on-module');
    if (toolbar) toolbar.before(moduleHost);
    else header?.after(moduleHost);
    const rows = [
      ...document.querySelectorAll<HTMLElement>('li.journey_row'),
    ].map((element) => {
      const host = document.createElement('ride-on-chip');
      const meta = element.querySelector('.journey_meta');
      if (meta) meta.before(host);
      else element.append(host);
      return {
        id: element.id.replace(/^jr_/, ''),
        element,
        mount: shadowMount(host),
      };
    });
    render(<Page rows={rows} />, shadowMount(moduleHost));
    send({ type: 'refresh' });
  },
});
