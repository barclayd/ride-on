// Renders src/pages/og.astro into public/og.png. Run after `bun run build`: it
// serves dist itself (astro preview only runs one server per machine) and
// screenshots /og at 1200×630.
import { chromium } from '@playwright/test';

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    for (const path of [pathname, `${pathname}/index.html`]) {
      const file = Bun.file(`dist${path}`);
      if (await file.exists()) return new Response(file);
    }
    return new Response('Not found', { status: 404 });
  },
});

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  await page.goto(new URL('/og', server.url).href, {
    waitUntil: 'networkidle',
  });
  await page.screenshot({ path: 'public/og.png' });
} finally {
  await browser.close();
  server.stop();
}
