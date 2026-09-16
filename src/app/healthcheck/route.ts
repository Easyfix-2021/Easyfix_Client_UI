/*
 * Liveness probe for the Client_UI Next.js process.
 *
 * Returns 200 with a tiny JSON body whenever the Next.js server is
 * responsive. Intentionally no DB ping, no backend call, no auth —
 * this is a *liveness* check ("is the process responding") not a
 * *readiness* check ("can the process do useful work"). Mixing the
 * two muddies signal: Client_UI is technically "live" even when the
 * backend is down — that's still useful information.
 *
 * Lives at /healthcheck (NOT /api/healthcheck) because next.config.mjs
 * rewrites /api/* to the backend; an /api/healthcheck route would be
 * silently proxied away from this server.
 *
 * Consumers:
 *   - Dockerfile HEALTHCHECK (container-level)
 *   - .github/workflows/deploy.yml smoke test (CI gate)
 *   - EasyFix_Backend/deploy/docker-compose.yml client-ui healthcheck
 *   - External monitors / load balancers
 */
import { NextResponse } from 'next/server';

// Force this route to be dynamic so the body's `timestamp` is fresh on
// every request (otherwise Next.js may static-render it at build time
// and serve a stale stamped value).
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'client-ui',
    // Baked in by the Dockerfile's GIT_COMMIT build arg; 'unknown' on a local
    // run. Lets a deploy be confirmed by SHA without asking GitHub.
    commit: process.env.GIT_COMMIT || 'unknown',
    timestamp: new Date().toISOString(),
  });
}

// HEAD requests should also return 200 — some monitors and load
// balancers send HEAD to avoid downloading the body.
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
