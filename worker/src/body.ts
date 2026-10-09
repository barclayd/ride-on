import { AppError } from './errors.ts';

export const readBoundedBody = async (
  request: Request,
  limit: number,
): Promise<Uint8Array> => {
  if (!request.body)
    throw new AppError(400, 'EMPTY_BODY', 'A request body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new AppError(
          413,
          'BODY_TOO_LARGE',
          `The request exceeds ${limit} bytes.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};
