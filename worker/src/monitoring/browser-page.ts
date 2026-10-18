import { Hono } from 'hono';
import type { Bindings } from '../types.ts';

// This page uses the same HttpOnly browser session as sign-in. The fragment never contains a token.
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Your tracked ride · Ride On</title><style>
:root{font:17px/1.5 system-ui,sans-serif;color-scheme:light dark;accent-color:#248a3d}body{margin:0;background:Canvas;color:CanvasText}main{max-width:38rem;margin:3rem auto;padding:0 1.25rem}h1{font-size:2rem;line-height:1.15}h2{font-size:1.1rem}p{margin:.7rem 0}section{border-top:1px solid GrayText;padding:1rem 0}button{font:inherit;padding:.6rem 1rem;border-radius:.6rem;border:1px solid GrayText;background:ButtonFace;color:ButtonText;cursor:pointer;margin:.25rem .5rem .25rem 0}button:disabled{opacity:.5;cursor:default}a{color:LinkText}.muted{color:GrayText}.score{font-size:2.5rem;font-weight:700}li{margin:.6rem 0}[hidden]{display:none!important}button:focus-visible,a:focus-visible{outline:3px solid Highlight;outline-offset:3px}@media(prefers-color-scheme:dark){:root{accent-color:#30d158}}
</style><script src="/notifications/page.js" defer></script></head><body><main><p class="muted">Ride On</p><h1>Your tracked ride</h1><p id="status" role="status" aria-live="polite">Loading your latest update…</p><div id="login" hidden><p>Sign in with the account that tracks this ride.</p><div id="providers"></div></div><div id="ride" hidden><p id="departure"></p><p id="lifecycle"></p><section><h2 id="assessment">Conditions</h2><p class="score" id="score"></p><p id="delta"></p><p id="minimums"></p><ul id="failures"></ul><p id="checked" class="muted"></p></section><section id="alternative" hidden><h2>Best assessed option</h2><p id="option"></p></section><section><h2>Recent alerts</h2><ul id="updates"></ul></section><button id="refresh" type="button">Check for changes</button><button id="stop" type="button">Stop tracking</button></div><p><a href="https://cycle.travel/user/journeys" rel="noreferrer">Open your cycle.travel journeys</a></p></main></body></html>`;

// Kept as a separate same-origin script so the page needs no inline-script CSP exception.
export const browserScript = `
'use strict';
const el = id => document.getElementById(id);
const text = (id, value) => { el(id).textContent = value; };
let id;
let switchAccount = false;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const request = async (path, options = {}) => {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  if (!response.ok) {
    const error = new Error(response.status === 401 ? 'Sign in to view your tracked ride.' : response.status === 404 ? 'This ride is unavailable. Check you are signed in to the right account.' : 'Could not load this update. Please try again.');
    error.status = response.status; throw error;
  }
  return response.status === 204 ? null : response.json();
};
let ride;
const date = value => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: ride.timeZone }).format(new Date(value));
const name = routeId => (ride.latestAssessment?.context.routes ?? ride.baseline.context.routes).find(r => r.id === routeId)?.name ?? 'Your ride';
const standards = { minimumTemperatureC: 'Minimum temperature', maximumTemperatureC: 'Maximum temperature', maximumGustKph: 'Maximum wind gust', maximumPrecipitationProbability: 'Rain probability', maximumPrecipitationRateMmH: 'Rain intensity' };
const reasons = { evening_summary: 'Evening summary', score_improved: 'Conditions improved', score_worsened: 'Conditions worsened', minimum_breach: 'A minimum was breached', minimum_recovery: 'A minimum recovered', better_option: 'A better option was found', unavailable: 'Forecast unavailable', available_again: 'Forecast available again' };
const render = () => {
  el('login').hidden = true; el('ride').hidden = false;
  document.querySelector('h1').textContent = name(ride.routeId);
  text('departure', date(ride.departureAt) + ' · ' + ride.timeZone);
  text('lifecycle', ride.state !== 'active' ? (ride.endedReason === 'replaced' ? 'You replaced this tracked ride. These are its saved updates.' : 'Tracking has ended. These are its saved updates.') : ride.refresh.closed ? 'Departure has passed. Monitoring has ended.' : 'Tracking this departure. Alerts follow your saved minimum conditions.');
  const snapshot = ride.latestAssessment ?? ride.baseline;
  const candidate = snapshot.pick.candidate;
  const current = ride.latestAssessmentKind === 'current';
  text('assessment', current ? 'Current conditions' : ride.latestAssessment ? 'Last known conditions' : 'Conditions when you chose this ride');
  text('score', Math.round(candidate.score) + '/100');
  const delta = Math.round(candidate.score) - Math.round(ride.baseline.pick.candidate.score);
  text('delta', (delta > 0 ? '+' : '') + delta + ' points since you chose this departure.');
  text('minimums', { meets: 'Meets your minimum conditions.', below: 'Below one or more of your minimum conditions.', unknown: 'Some minimum conditions could not be assessed.', not_configured: 'No minimum conditions are configured.' }[candidate.standards.status]);
  el('failures').replaceChildren(...candidate.standards.failures.map(f => { const li = document.createElement('li'); li.textContent = standards[f.standard] ?? 'A minimum condition'; return li; }));
  text('checked', (ride.refresh.lastSuccessfulAssessmentAt ? 'Last assessed ' + date(ride.refresh.lastSuccessfulAssessmentAt) + '. ' : '') + (current ? '' : 'This is saved information; a current forecast is not available.'));
  const best = ride.comparison?.bestPick;
  el('alternative').hidden = !best || best.departureStillRecommended !== false;
  if (best) text('option', name(best.bestKnown.routeId) + ' · ' + date(best.bestKnown.departureAt) + ' · ' + Math.round(best.bestKnown.score) + '/100' + (best.coverage === 'incomplete' ? '. Some options could not be assessed.' : ''));
  el('stop').disabled = ride.state !== 'active';
  el('refresh').disabled = ride.refresh.closed || ride.refresh.result === 'in_progress' || (ride.refresh.refreshAt && Date.parse(ride.refresh.refreshAt) > Date.now());
  if (!ride.refresh.closed && el('refresh').disabled) text('status', ride.refresh.result === 'in_progress' ? 'A check is already in progress. Reload this page shortly.' : 'Next forecast check available ' + date(ride.refresh.refreshAt) + '.');
  else text('status', '');
};
const login = async () => {
  el('ride').hidden = true; el('login').hidden = false;
  const { providers } = await request('/auth/providers');
  el('providers').replaceChildren(...providers.map(provider => {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = 'Continue with ' + (provider === 'apple' ? 'Apple' : 'Google');
    button.onclick = async () => {
      button.disabled = true;
      try {
        if (switchAccount) await request('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const result = await request('/api/auth/sign-in/social', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, callbackURL: location.origin + '/notifications/open#ride=' + id, errorCallbackURL: location.origin + '/notifications/open#ride=' + id, disableRedirect: true }) });
        const target = new URL(result.url); if (target.protocol !== 'https:') throw new Error('Sign-in is temporarily unavailable.');
        location.assign(target.href);
      } catch (error) { text('status', error.message); button.disabled = false; }
    };
    return button;
  }));
};
const fail = async error => {
  text('status', error.message);
  switchAccount = error.status === 404;
  if (error.status === 401 || error.status === 404) await login().catch(() => text('status', 'Sign-in is temporarily unavailable. Please reload to try again.'));
};
const load = async () => {
  const requestedId = id;
  const result = await request('/tracked-rides/' + requestedId);
  if (requestedId !== id) return;
  ride = result.ride; render();
  try {
    const { notifications } = await request('/tracked-rides/' + requestedId + '/notifications');
    if (requestedId !== id) return;
    const sent = notifications.filter(n => n.acceptedAt);
    el('updates').replaceChildren(...sent.map(n => {
      const li = document.createElement('li');
      li.textContent = date(n.createdAt) + ': ' + n.decision.reasons.map(r => reasons[r] ?? 'Ride update').join('; ') + (n.decision.score === null ? '' : ' · ' + Math.round(n.decision.score) + '/100');
      return li;
    }));
    if (!sent.length) el('updates').textContent = 'No alerts have been sent for this ride.';
  } catch { el('updates').textContent = 'Recent alerts could not be loaded.'; }
};
el('refresh').onclick = async () => { el('refresh').disabled = true; try { await request('/tracked-rides/' + id + '/refresh', { method: 'POST' }); await load(); } catch (error) { el('refresh').disabled = false; await fail(error); } };
el('stop').onclick = async () => { if (!confirm('Stop monitoring this departure on all your devices?')) return; el('stop').disabled = true; try { await request('/tracked-rides/' + id, { method: 'DELETE' }); await load(); } catch (error) { el('stop').disabled = false; await fail(error); } };
const start = () => {
  id = new URLSearchParams(location.hash.slice(1)).get('ride');
  el('ride').hidden = true; el('login').hidden = true;
  text('status', 'Loading your latest update…');
  if (id && uuid.test(id)) load().catch(fail); else text('status', 'This notification link is incomplete. Open Ride On to choose a tracked ride.');
};
window.addEventListener('hashchange', start);
start();
`;
export const browserNotificationRoutes = () => {
  const app = new Hono<Bindings>();
  app.get('/notifications/open', (c) => {
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(html);
  });
  app.get('/notifications/page.js', (c) => {
    c.header('Content-Type', 'text/javascript; charset=utf-8');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(browserScript);
  });
  return app;
};
