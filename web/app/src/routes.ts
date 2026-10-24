import { get, post, route } from 'remix/routes';

export const routes = route({
  home: get('/'),
  route: get('/routes/:routeId'),
  signIn: get('/sign-in'),
  startSignIn: post('/sign-in'),
  callback: get('/auth/callback'),
  signOut: post('/sign-out'),
  // The BFF proxy (SPEC §11.2): any method.
  api: '/api/*path',
});
