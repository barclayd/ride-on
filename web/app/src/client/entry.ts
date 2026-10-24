import { run } from 'remix/component';

// Hydrates every client entry on the page (only the map so far). Entries are served as built files
// under /assets, so a plain import resolves them.
const app = run({
  async loadModule(url, name) {
    return (await import(url))[name];
  },
});
app.addEventListener('error', (event) =>
  console.error('Component error:', event.error),
);
await app.ready();
