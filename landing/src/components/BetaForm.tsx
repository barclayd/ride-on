import { type SubmitEvent, useEffect, useRef, useState } from 'react';

/** The beta sign-up. Nothing is sent or stored yet: it only thanks you. */
export default function BetaForm() {
  const [joined, setJoined] = useState(false);
  const thanks = useRef<HTMLParagraphElement>(null);

  // The button that was focused is gone, so move focus (and screen readers) to the thank-you.
  useEffect(() => {
    if (joined) thanks.current?.focus();
  }, [joined]);

  const join = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    // POST the address to the beta list here, once there is one.
    setJoined(true);
  };

  if (joined) {
    return (
      <p ref={thanks} className="beta-joined" tabIndex={-1}>
        ✓ You're on the list.
      </p>
    );
  }

  return (
    <form className="beta-form" onSubmit={join}>
      <input
        type="email"
        name="email"
        required
        placeholder="you@example.com"
        aria-label="Email address"
        autoComplete="email"
      />
      <button type="submit">Join the beta</button>
    </form>
  );
}
