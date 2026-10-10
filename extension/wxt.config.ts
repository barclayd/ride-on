import { defineConfig } from 'wxt';

// Tests build against a local mock API; real builds use production.
const apiUrl = process.env.WXT_API_URL ?? 'https://api.ride-on.cc';

export default defineConfig({
  imports: false,
  zip: { artifactTemplate: '{{name}}-{{version}}-{{browser}}.zip' },
  vite: () => ({
    define: { __API_URL__: JSON.stringify(apiUrl) },
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  }),
  manifest: {
    name: 'Ride On',
    description:
      'Pick the best of your saved cycle.travel routes, and the best time to ride it.',
    // CI stamps release builds; otherwise WXT uses package.json's version.
    version: process.env.EXTENSION_VERSION,
    // Fixed public key → stable ID gafikjcoeoddjgojefhmdpjkjpbhmjle, so the OAuth
    // redirect https://<id>.chromiumapp.org/ride-on stays registered for unpacked installs.
    // The Web Store rejects `key`, so STORE_BUILD drops it and the store assigns its own ID.
    key: process.env.STORE_BUILD
      ? undefined
      : 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2X7uyn3ju7ym9BcGtb6S63MFM3DmWHcZp7k80dk1/g2X0ehL3mo51+Tg+CshNrQxcuA0pUo/NFmPGEvTtNLNjZxBdc57F/qD3WuWa+4NGSXWu03JXnhC6pt6QTq643rRlg+FLNX5GFjs2NyDQs6QKTdOWHPoZiIARiKHasaU88bObdMmeVUwfLhWQaETdhYQYdR2LhDJWIjf2qV/z+LV1Jq4e4eSQlXsgR2jvY8f4UPdRB2RDmroGp8LyEcGbwjldRdxuwNk7+GCgCAfWv2/ys9JXew0NYGniI3Uh6WFlp+QjDZC7c2eHqMnVtH75EXpw2toozKzDu3qaP9t2Lup/wIDAQAB',
    permissions: ['identity', 'storage'],
    host_permissions: [`${apiUrl}/*`],
    action: { default_title: 'Ride On' },
    web_accessible_resources: [
      {
        resources: ['fonts/*', 'ride-on-icon.png'],
        matches: ['https://cycle.travel/*'],
      },
    ],
  },
});
