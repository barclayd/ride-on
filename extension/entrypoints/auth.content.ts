import { defineContentScript } from 'wxt/utils/define-content-script';
import { SAFARI_REDIRECT } from '../lib/auth';
import { send } from '../lib/state';

// Safari only: its sign-in tab ends here; hand the code and state to the background.
export default defineContentScript({
  matches: [`${SAFARI_REDIRECT}*`],
  include: ['safari'],
  runAt: 'document_start',
  main() {
    send({ type: 'signInRedirect', url: location.href });
  },
});
