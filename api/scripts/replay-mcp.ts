import { ALGORITHM_VERSION } from '../src/recommendations/engine.ts';
import { fingerprint } from '../src/recommendations/fingerprint.ts';
import {
  replayScore,
  type ScoreReplay,
} from '../src/recommendations/replay.ts';

const path = process.argv[2];
if (!path)
  throw new Error(
    'Usage: bun scripts/replay-mcp.ts <saved-structuredContent.json>',
  );
const file = Bun.file(path);
if (file.size > 50_000_000)
  throw new Error('Replay files are limited to 50 MB.');
const result = JSON.parse(await file.text()) as {
  evidence: { algorithmVersion: string; replay?: ScoreReplay[] };
  evidenceSha256: string;
};
if (result.evidence?.algorithmVersion !== ALGORITHM_VERSION)
  throw new Error(
    'Check out the algorithm version recorded in the evidence before replaying.',
  );
if ((await fingerprint(result.evidence)) !== result.evidenceSha256)
  throw new Error('Evidence checksum does not match.');
if (!result.evidence.replay?.length)
  throw new Error('Request the assessment with includeReplay: true.');
console.log(
  JSON.stringify(
    result.evidence.replay.map((replay) => ({
      date: replay.input.date,
      result: replayScore(replay),
    })),
    null,
    2,
  ),
);
