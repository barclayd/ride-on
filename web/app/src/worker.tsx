import { env } from 'cloudflare:workers';
import { cop } from 'remix/middleware/cop';
import { type RenderFunction, render } from 'remix/middleware/render';
import { redirect } from 'remix/response/redirect';
import { createRouter } from 'remix/router';
import { libraryGeometry } from './geometry.ts';
import { Home, SignIn } from './pages.tsx';
import { routes } from './routes.ts';
import {
  callApi,
  challengeFor,
  type Handoff,
  handoffCookie,
  json,
  proxy,
  random,
  readHandoff,
  readToken,
  safeNext,
  sessionCookie,
} from './session.ts';

// cop(): SameSite=Lax still lets other ride-on.cc subdomains post here; Sec-Fetch-Site doesn't.
const router = createRouter({ middleware: [cop(), render()] });

const signInFor = (url: URL) =>
  url.pathname === '/'
    ? routes.signIn.href()
    : `${routes.signIn.href()}?next=${encodeURIComponent(url.pathname + url.search)}`;

router.map(routes, {
  actions: {
    async home(context) {
      return showMap(context.request, context.url, context.render);
    },
    async route(context) {
      // ponytail: the map without the route selected; the detail view is a v1 screen (SPEC §7.2).
      return showMap(context.request, context.url, context.render);
    },
    signIn(context) {
      return context.render(
        <SignIn next={safeNext(context.url.searchParams.get('next'))} />,
      );
    },
    async startSignIn(context) {
      const form = await context.request.formData();
      const provider = form.get('provider');
      const next = safeNext(form.get('next')?.toString());
      if (provider !== 'google' && provider !== 'apple')
        return context.render(
          <SignIn next={next} error="Choose Google or Apple." />,
          { status: 400 },
        );
      const handoff: Handoff = {
        verifier: random(48),
        state: random(24),
        next,
      };
      const started = await callApi(
        env.API,
        context.request,
        '/auth/browser/start',
        null,
        json({
          provider,
          redirectUri: new URL(routes.callback.href(), context.url).href,
          codeChallenge: await challengeFor(handoff.verifier),
          state: handoff.state,
        }),
      );
      if (!started.ok)
        return context.render(
          <SignIn next={next} error="Couldn't start sign-in. Try again." />,
          {
            status: 502,
          },
        );
      const { authorizationUrl } = (await started.json()) as {
        authorizationUrl: string;
      };
      return redirect(authorizationUrl, {
        status: 303,
        headers: {
          'Set-Cookie': await handoffCookie.serialize(JSON.stringify(handoff)),
        },
      });
    },
    async callback(context) {
      const handoff = await readHandoff(context.request);
      const code = context.url.searchParams.get('code');
      const clear = await handoffCookie.serialize('', { maxAge: 0 });
      const failed = (status: number) =>
        context.render(
          <SignIn next="/" error="Sign-in didn't finish. Try again." />,
          {
            status,
            headers: { 'Set-Cookie': clear },
          },
        );
      if (
        !handoff ||
        !code ||
        context.url.searchParams.get('state') !== handoff.state
      )
        return failed(400);
      const exchanged = await callApi(
        env.API,
        context.request,
        '/auth/browser/exchange',
        null,
        json({
          code,
          codeVerifier: handoff.verifier,
          redirectUri: new URL(routes.callback.href(), context.url).href,
        }),
      );
      if (!exchanged.ok) return failed(502);
      const { token } = (await exchanged.json()) as { token: string };
      const headers = new Headers({ Location: safeNext(handoff.next) });
      headers.append('Set-Cookie', await sessionCookie.serialize(token));
      headers.append('Set-Cookie', clear);
      return new Response(null, { status: 303, headers });
    },
    async signOut(context) {
      // The cookie only: signing out must never revoke the seeded local session.
      const token = await readToken(context.request);
      if (token)
        await callApi(
          env.API,
          context.request,
          '/api/auth/sign-out',
          token,
          json({}),
        );
      return redirect(routes.signIn.href(), {
        status: 303,
        headers: {
          'Set-Cookie': await sessionCookie.serialize('', { maxAge: 0 }),
          // The cached geometry and colour slots are the rider's; the next rider on this browser starts clean.
          'Clear-Site-Data': '"storage"',
        },
      });
    },
    async libraryGeometry(context) {
      const ids = context.url.searchParams.get('ids');
      return libraryGeometry(
        env.API,
        context.request,
        await readToken(context.request, env.DEV_SESSION_TOKEN),
        ids ? ids.split(',') : [],
      );
    },
    async api(context) {
      return proxy(
        env.API,
        context.request,
        await readToken(context.request, env.DEV_SESSION_TOKEN),
      );
    },
  },
});

/** Signed-in pages: prove the session with `/auth/me`, then render the map. */
async function showMap(request: Request, url: URL, render: RenderFunction) {
  const token = await readToken(request, env.DEV_SESSION_TOKEN);
  if (!token) return redirect(signInFor(url), 303);
  const me = await callApi(env.API, request, '/auth/me', token);
  if (me.status === 401)
    return redirect(signInFor(url), {
      status: 303,
      headers: {
        'Set-Cookie': await sessionCookie.serialize('', { maxAge: 0 }),
      },
    });
  // ponytail: a plain 502; the designed error states are v1 (SPEC §7.8).
  if (!me.ok)
    return new Response("Ride On can't reach its server right now.", {
      status: 502,
    });
  const headers = new Headers();
  for (const cookie of me.headers.getSetCookie())
    headers.append('Set-Cookie', cookie);
  return render(<Home />, { headers });
}

export default { fetch: (request: Request) => router.fetch(request) };
