// Copies the API's seeded local session (worker: `bun run dev:session`) into .dev.vars, so
// http://localhost:8788 is signed in without running the Apple or Google handoff.
const session = (await Bun.file('../../api/.local-session.json').json()) as {
  token: string;
};
await Bun.write('.dev.vars', `DEV_SESSION_TOKEN=${session.token}\n`);
console.log('Wrote DEV_SESSION_TOKEN to .dev.vars');
