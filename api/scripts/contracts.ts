import SwaggerParser from '@apidevtools/swagger-parser';
import openapiTS, { astToString } from 'openapi-typescript';
import { createApp } from '../src/app.ts';

const app = createApp({ log: false });
const document = app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: {
    title: 'Ride On API',
    version: '0.42.0',
    description:
      'Library, shortlist and profile contracts. See coverage.json and docs/protocol.md for the remaining API surface.',
  },
  servers: [{ url: 'https://api.ride-on.cc' }],
});
await SwaggerParser.validate(JSON.parse(JSON.stringify(document)));
const runtime = [
  ...new Set(
    app.routes
      .filter((r) => r.method !== 'ALL')
      .map((r) => `${r.method} ${r.path.replace(/:([^/]+)/g, '{$1}')}`),
  ),
].sort();
const documented = Object.entries(document.paths ?? {})
  .flatMap(([path, item]) =>
    Object.keys(item ?? {})
      .filter((method) =>
        ['get', 'post', 'patch', 'put', 'delete', 'options', 'head'].includes(
          method,
        ),
      )
      .map((method) => `${method.toUpperCase()} ${path}`),
  )
  .sort();
for (const operation of documented) {
  if (!runtime.includes(operation))
    throw new Error(`Contract has no registered handler: ${operation}`);
}
const coverage = {
  documented,
  existingHandlers: runtime.filter((route) => !documented.includes(route)),
  delegated: ['Better Auth /api/auth/* (vendor-owned protocol)'],
};
const artifacts = {
  'openapi.json': `${JSON.stringify(document, null, 2)}\n`,
  'client.d.ts': astToString(await openapiTS(JSON.stringify(document))),
  'coverage.json': `${JSON.stringify(coverage, null, 2)}\n`,
};
for (const [name, contents] of Object.entries(artifacts)) {
  const file = Bun.file(new URL(`../contracts/${name}`, import.meta.url));
  if (process.argv.includes('--check')) {
    if (!(await file.exists()) || (await file.text()) !== contents)
      throw new Error(`${name} is stale; run bun run contracts:generate`);
  } else await Bun.write(file, contents);
}
console.log(
  `${documented.length} registered operations; ${coverage.existingHandlers.length} existing handlers explicitly listed outside this contract`,
);

// Swift consumes the same synthetic JSON fixtures as Zod/OpenAPI checks.
for (const name of ['selection-empty', 'selection-saved', 'error-conflict']) {
  const source = await Bun.file(
    new URL(`../contracts/fixtures/${name}.json`, import.meta.url),
  ).text();
  const target = Bun.file(
    new URL(
      `../../apple/Packages/Infrastructure/Tests/NetworkingTests/Fixtures/${name}.json`,
      import.meta.url,
    ),
  );
  if (process.argv.includes('--check')) {
    if (!(await target.exists()) || (await target.text()) !== source)
      throw new Error(`Swift fixture ${name} is stale`);
  } else await Bun.write(target, source);
}
