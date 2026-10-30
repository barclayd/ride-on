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
          <form method="post" action={routes.signOut.href()}>
            <button class="control glass" type="submit">
              Sign out
            </button>
          </form>
        }
      />
    </Document>
  );
}

export function SignIn(handle: Handle<{ next: string; error?: string }>) {
  return () => (
    <Document title="Sign in · Ride On">
      <main class="sign-in">
        <form
          class="card glass"
          method="post"
          action={routes.startSignIn.href()}
        >
          <h1>Ride On</h1>
          <p>Your saved routes, on the cycle map.</p>
          <input type="hidden" name="next" value={handle.props.next} />
          <button class="btn tint" type="submit" name="provider" value="apple">
            Continue with Apple
          </button>
          <button class="btn tint" type="submit" name="provider" value="google">
            Continue with Google
          </button>
          {handle.props.error && <p role="alert">{handle.props.error}</p>}
        </form>
      </main>
    </Document>
  );
}
