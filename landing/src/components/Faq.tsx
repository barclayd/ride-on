import { useId, useState } from 'react';

const FAQ = [
  [
    'Does it give directions?',
    'No. It recommends; use your bike computer or favourite app to navigate.',
  ],
  ['Where does it work?', 'Great Britain for now.'],
  [
    'What does the score mean?',
    'How well the forecast fits your preferences, not a probability of anything.',
  ],
  [
    'Which weather does it use?',
    'Apple Weather by default, or the Met Office.',
  ],
  ['Do I need Strava?', "No. It's optional, for logging rides."],
  ['What does it cost?', 'To be decided.'],
] as const;

/** One answer open at a time. */
export default function Faq() {
  const [open, setOpen] = useState(-1);
  const id = useId();

  return (
    <div className="faq-list">
      {FAQ.map(([question, answer], i) => {
        const isOpen = open === i;
        return (
          <div key={question} className={isOpen ? 'faq-item open' : 'faq-item'}>
            <h3>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`${id}-${i}`}
                onClick={() => setOpen(isOpen ? -1 : i)}
              >
                {question}
                <span className="faq-plus" aria-hidden="true">
                  +
                </span>
              </button>
            </h3>
            <div id={`${id}-${i}`} className="faq-answer" inert={!isOpen}>
              <div>
                <p>{answer}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
