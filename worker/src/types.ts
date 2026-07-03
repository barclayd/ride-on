export type Env = {
  CLASSIFY_CACHE: KVNamespace;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
};

export type Bindings = { Bindings: Env };

/** A [lat, lon] pair. */
export type Point = readonly [number, number];
