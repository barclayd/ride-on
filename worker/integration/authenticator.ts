import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { type CBORType, encodeCBOR } from '@levischuck/tiny-cbor';

const hash = (v: string | Buffer) => createHash('sha256').update(v).digest();
const encode = (v: string | Uint8Array) => Buffer.from(v).toString('base64url');
type Ceremony = {
  challenge: string;
  rpId: string;
  origin: string;
  verified?: boolean;
};

/** Synthetic ES256 authenticator; the real Worker verifies CBOR and signatures. */
export const authenticator = () => {
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = key.publicKey.export({ format: 'jwk' });
  const credential = randomBytes(32);
  const id = encode(credential);
  const base = {
    id,
    rawId: id,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    clientExtensionResults: {},
  };
  const data = (input: Ceremony, registration: boolean, counter = 0) => {
    const clientData = Buffer.from(
      JSON.stringify({
        type: registration ? 'webauthn.create' : 'webauthn.get',
        challenge: input.challenge,
        origin: input.origin,
        crossOrigin: false,
      }),
    );
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    const authData = Buffer.concat([
      hash(input.rpId),
      Buffer.from([
        1 | (input.verified === false ? 0 : 4) | (registration ? 64 : 0),
      ]),
      count,
    ]);
    return { clientData, authData };
  };
  return {
    id,
    registration: (input: Ceremony) => {
      const { clientData, authData } = data(input, true);
      const length = Buffer.alloc(2);
      length.writeUInt16BE(credential.length);
      const publicKey = encodeCBOR(
        new Map<number, CBORType>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x ?? '', 'base64url')],
          [-3, Buffer.from(jwk.y ?? '', 'base64url')],
        ]),
      );
      const attestation = encodeCBOR(
        new Map<string, CBORType>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          [
            'authData',
            Buffer.concat([
              authData,
              Buffer.alloc(16),
              length,
              credential,
              publicKey,
            ]),
          ],
        ]),
      );
      return {
        ...base,
        response: {
          clientDataJSON: encode(clientData),
          attestationObject: encode(attestation),
          transports: ['internal'],
        },
      };
    },
    authentication: (
      input: Ceremony & { counter?: number; badSignature?: boolean },
    ) => {
      const { clientData, authData } = data(input, false, input.counter ?? 1);
      const signature = sign(
        'sha256',
        Buffer.concat([authData, hash(clientData)]),
        key.privateKey,
      );
      if (input.badSignature)
        signature[signature.length - 1] =
          (signature[signature.length - 1] ?? 0) ^ 1;
      return {
        ...base,
        response: {
          clientDataJSON: encode(clientData),
          authenticatorData: encode(authData),
          signature: encode(signature),
        },
      };
    },
  };
};
