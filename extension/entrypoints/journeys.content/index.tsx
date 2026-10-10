import { render } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  fetchJourney,
  fetchJourneyGpx,
  fetchJourneyList,
  type JourneyListItem,
} from '../../lib/cycletravel';
import { send } from '../../lib/state';
import { MAX_TRACKED, type RouteSummary } from '../../lib/types';
import {
  Badge,
  CardLines,
  CloseButton,
  DayPresets,
  ErrorChip,
  iconUrl,
  injectFonts,
  Pips,
  Score,
  useView,
  type View,
} from '../../ui/components';
import { type Card, timeLabel } from '../../ui/format';
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

const Pinned = ({ card, href }: { card: Card; href: string | null }) => (
  <article
    class={`ro-pinned${card.top ? ' ro-top' : card.state === 'no-ride' ? ' ro-no-ride' : ''}`}
  >
    <div class="ro-pinned-head">
      <Badge card={card} />
      {href ? (
        <a class="ro-name" href={href} title={card.name}>
          {card.name}
        </a>
      ) : (
        <span class="ro-name" title={card.name}>
          {card.name}
        </span>
      )}
      <CloseButton
        title="Stop considering"
        onClick={() => send({ type: 'untrack', routeId: card.routeId })}
      />
    </div>
    <CardLines card={card}>No ride meets your minimums.</CardLines>
    <div class="ro-footer">
      <span class="ro-bar">
        <span style={{ width: `${card.score ?? 0}%` }} />
      </span>
      <Score card={card} />
      <Pips level={card.confidence} />
      <span class="ro-serif ro-muted" style={{ fontSize: '12px' }}>
        {card.km} km
      </span>
    </div>
  </article>
);

const chipLabel = (card: Card) =>
  card.state === 'ok'
    ? `${card.day} ${card.window}`
    : card.state === 'no-ride'
      ? 'No good window'
      : 'Considering…';

const Picker = (props: {
  view: View;
  tracked: Map<string, string>; // externalId → routeId
  busy: Set<string>;
  toggle: (externalId: string) => void;
  onClose: () => void;
}) => {
  const [journeys, setJourneys] = useState<JourneyListItem[] | null>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    fetchJourneyList().then(setJourneys, () => setJourneys([]));
  }, []);
  const count = props.view.cards.length;
  const query = filter.trim().toLowerCase();
  const shown = (journeys ?? []).filter((j) =>
    j.name.toLowerCase().includes(query),
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim only closes; the dialog holds the controls.
    <div
      class="ro-scrim"
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
      onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
    >
      <div
        class="ro-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Under consideration"
      >
        <div class="ro-dialog-head">
          Under consideration
          <CloseButton title="Close" onClick={props.onClose} />
        </div>
        <div class="ro-dialog-filter">
          <input
            type="search"
            placeholder="Filter routes"
            aria-label="Filter routes"
            value={filter}
            onInput={(e) => setFilter(e.currentTarget.value)}
            // biome-ignore lint/a11y/noAutofocus: the picker opens to filter.
            autoFocus
          />
          <span class="ro-serif ro-muted" style={{ fontSize: '12px' }}>
            {count} / {MAX_TRACKED} selected
          </span>
        </div>
        <div class="ro-dialog-list">
          {journeys === null && <p class="ro-empty">Loading your routes…</p>}
          {shown.map((journey) => {
            const id = String(journey.id);
            const checked = props.tracked.has(id);
            const busy = props.busy.has(id);
            return (
              <button
                key={id}
                type="button"
                class="ro-pick"
                aria-pressed={checked}
                disabled={busy || (!checked && count >= MAX_TRACKED)}
                onClick={() => props.toggle(id)}
              >
                <span class={`ro-check${checked ? ' ro-on' : ''}`}>
                  {checked ? '✓' : ''}
                </span>
                <span>{journey.name}</span>
                <span>
                  {Math.round(journey.distance / 1000)} km · {journey.date}
                </span>
              </button>
            );
          })}
        </div>
        <div class="ro-dialog-foot">
          <button
            type="button"
            class="ro-primary"
            style={{ padding: '9px 18px' }}
            onClick={props.onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

const Page = ({ rows, overlay }: { rows: Row[]; overlay: HTMLElement }) => {
  const view = useView();
  const [busy, setBusy] = useState(new Set<string>());
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
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
          <span>Under consideration</span>
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

  const { cards, planning } = view;
  const full = cards.length >= MAX_TRACKED;
  const cardByRoute = new Map(cards.map((card) => [card.routeId, card]));
  const href = (route: RouteSummary | undefined) =>
    route?.source ? `/map/journey/${route.source.externalId}` : null;

  return (
    <section class="ro-module" aria-label="Under consideration">
      <div class="ro-module-head">
        <div class="ro-module-title">
          <span>Under consideration</span>
          <span>
            {cards.length} / {MAX_TRACKED}
          </span>
        </div>
        <div class="ro-module-actions">
          <ErrorChip view={view} />
          {notice && (
            <span class="ro-warn-chip" role="status">
              {notice}
            </span>
          )}
          <DayPresets view={view} inline />
          <button
            type="button"
            class="ro-secondary ro-serif"
            onClick={() => send({ type: 'openPopup', tab: 'when' })}
          >
            {timeLabel(planning)}
          </button>
          <button
            type="button"
            class="ro-secondary"
            onClick={() => setPicking(true)}
          >
            Customise
          </button>
        </div>
      </div>
      <div class="ro-grid ro-loading" data-loading={view.state.loading}>
        {cards.map((card) => (
          <Pinned
            key={card.routeId}
            card={card}
            href={href(routes[card.routeId])}
          />
        ))}
        {!full && (
          <button type="button" class="ro-add" onClick={() => setPicking(true)}>
            + Add ride
          </button>
        )}
      </div>
      {rows.map((row) => {
        const routeId = tracked.get(row.id);
        const card = routeId && cardByRoute.get(routeId);
        const working = busy.has(row.id);
        return createPortal(
          card ? (
            <button
              type="button"
              class={`ro-chip ${card.state === 'no-ride' ? 'ro-no-ride' : 'ro-tracked'}`}
              title="Stop considering"
              disabled={working}
              onClick={() => toggle(row.id)}
            >
              {chipLabel(card)}
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
      {picking &&
        createPortal(
          <Picker
            view={view}
            tracked={tracked}
            busy={busy}
            toggle={toggle}
            onClose={() => setPicking(false)}
          />,
          overlay,
        )}
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
    const overlayHost = document.createElement('ride-on-overlay');
    document.body.append(overlayHost);
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
    render(
      <Page rows={rows} overlay={shadowMount(overlayHost)} />,
      shadowMount(moduleHost),
    );
    send({ type: 'refresh' });
  },
});
