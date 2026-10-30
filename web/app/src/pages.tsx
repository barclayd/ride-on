import type { Handle, RemixNode } from 'remix/component';
import { CycleMap } from './client/cycle-map.tsx';
import { Overlays, Panel } from './client/panel.tsx';
import { routes } from './routes.ts';

function Document(handle: Handle<{ title?: string; children?: RemixNode }>) {
  return () => (
    <html lang="en-GB">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <title>{handle.props.title ?? 'Ride On'}</title>
        <link rel="icon" href="/favicon.png" />
        <link rel="stylesheet" href="/tokens.css" />
        <link rel="stylesheet" href="/vendor/maplibre-gl/maplibre-gl.css" />
        <link rel="stylesheet" href="/app.css" />
        <script type="module" src="/assets/entry.js"></script>
      </head>
      <body>{handle.props.children}</body>
    </html>
  );
}

type Slots = {
  panel?: RemixNode;
  dayStrip?: RemixNode;
  controls?: RemixNode;
  overlay?: RemixNode;
};

/** Every signed-in screen (SPEC §5.3): the map never unmounts; routes only swap the slots. */
function MapShell(handle: Handle<Slots>) {
  return () => {
    const { panel, dayStrip, controls, overlay } = handle.props;
    return (
      <main class="shell">
        <CycleMap />
        {panel && <aside class="panel glass">{panel}</aside>}
        {dayStrip && <nav class="day-strip glass">{dayStrip}</nav>}
        {controls && <div class="controls">{controls}</div>}
        {overlay}
      </main>
    );
  };
}

export function Home() {
  return () => (
    <Document>
      <MapShell
        panel={<Panel />}
        overlay={<Overlays />}
        controls={
          // ponytail: sign-out moves into Preferences (SPEC §7.4) with the v1 panel.
          // data-rmx-document: a full page load, so the last rider's board doesn't stay in memory.
          <form method="post" action={routes.signOut.href()} data-rmx-document>
            <button class="control glass" type="submit">
              Sign out
            </button>
          </form>
        }
      />
    </Document>
  );
}

// The providers' own marks: Apple's logo takes the button's text colour, Google's G keeps its colours.
const AppleLogo = () => () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
    />
  </svg>
);

const GoogleLogo = () => () => (
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

/** Sign-in sits where the panel will be once you're in, over the cycle map. */
export function SignIn(handle: Handle<{ next: string; error?: string }>) {
  return () => (
    <Document title="Sign in · Ride On">
      <main class="shell">
        <CycleMap backdrop />
        {/* data-rmx-document: Remix would fetch the post, and a fetch can't follow the redirect to Apple or Google. */}
        <form
          class="sign-in glass"
          method="post"
          action={routes.startSignIn.href()}
          data-rmx-document
        >
          <img class="app-icon" src="/icon.png" alt="" width="64" height="64" />
          <h1>Ride On</h1>
          <p>Sign in to see which of your routes to ride, and when.</p>
          <input type="hidden" name="next" value={handle.props.next} />
          <button class="sso apple" type="submit" name="provider" value="apple">
            <AppleLogo />
            Continue with Apple
          </button>
          <button
            class="sso google"
            type="submit"
            name="provider"
            value="google"
          >
            <GoogleLogo />
            Continue with Google
          </button>
          {handle.props.error && <p role="alert">{handle.props.error}</p>}
        </form>
      </main>
    </Document>
  );
}
