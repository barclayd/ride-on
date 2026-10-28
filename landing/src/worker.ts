interface Env {
  ASSETS: Fetcher;
}

// Set here rather than in public/_headers, which Cloudflare skips once run_worker_first is on.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.ride-on.cc') {
      url.hostname = 'ride-on.cc';
      return Response.redirect(url.toString(), 301);
    }

    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(name, value);
    }
    // Astro fingerprints everything under /_astro, so it never changes in place.
    if (url.pathname.startsWith('/_astro/')) {
      response.headers.set(
        'Cache-Control',
        'public, max-age=31536000, immutable',
      );
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
