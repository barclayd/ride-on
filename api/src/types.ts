export type Env = Cloudflare.Env & {
  APNS_CONFIG_JSON?: string;
  WEB_PUSH_CONFIG_JSON?: string;
  CWA_API_KEY?: string;
};

export type Bindings = { Bindings: Env; Variables: { ownerId: string } };

/** A [lat, lon] pair. */
export type Point = readonly [number, number];
