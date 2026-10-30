import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://ride-on.cc',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [
    react(),
    // /og only exists for scripts/og.ts to screenshot.
    sitemap({ filter: (page) => !page.includes('/og') }),
  ],
  build: { inlineStylesheets: 'always' },
});
