export type Env = Cloudflare.Env;

export type Bindings = { Bindings: Env; Variables: { ownerId: string } };

/** A [lat, lon] pair. */
export type Point = readonly [number, number];
