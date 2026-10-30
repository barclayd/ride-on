import { get, post, route } from 'remix/routes';

export const routes = route({
  home: get('/'),
  route: get('/routes/:routeId'),
  signIn: get('/sign-in'),
  startSignIn: post('/sign-in'),
  callback: get('/auth/callback'),
  signOut: post('/sign-out'),
  // SPEC §12.4. More specific than the proxy below, so it wins.
  libraryGeometry: get('/api/library-geometry'),
  // The BFF proxy (SPEC §11.2): any method.
  api: '/api/*path',
});
