import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { parseAppMode, modeFlags } from "./src/shared/lib/appModeCore";

// Reads APP_MODE directly rather than importing lib/appMode: next.config runs outside
// the app's module graph, and appMode.ts pulls in the company constants. appModeCore.ts
// is dependency-free precisely so this file (and the build scripts) can share the same
// mode contract without that import.
const { hasOfficeRoutes, indexable } = modeFlags(parseAppMode(process.env.APP_MODE));

// Set only when building the artifact that runs ON a shop counter PC (localhost:3000
// against a local Postgres replica). Unset everywhere else, so the Vercel build below
// is byte-identical to what it has always produced.
const COUNTER_BUILD = process.env.COUNTER_BUILD === "1";

// The image optimizer fetches only from OUR Cloudinary cloud and OUR Supabase project.
// A bare `res.cloudinary.com` / `*.supabase.co` admits every tenant of those services:
// anyone can host a file there and push it through our optimizer. Hostname-only is
// kept as the fallback when the env is missing (a dev checkout without keys).
const CLOUDINARY_CLOUD = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim();
const SUPABASE_HOST = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname; } catch { return ""; }
})();

const nextConfig: NextConfig = {
  // The desktop shell loads http://127.0.0.1:<port> while `next dev` treats only
  // `localhost` as its own origin, so under `pnpm electron:dev` the HMR socket was
  // refused and the dev client reloaded the page every ~45 s without ever hydrating.
  // Dev-only: `next start` has no such check.
  // `192.168.*.*` lets a phone on the shop Wi-Fi open the dev server by the PC's LAN
  // address (http://192.168.x.x:3000) — wildcarded because DHCP moves that address.
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*"],
  // Standalone traces the server and its deps into one folder we can copy onto the
  // counter — no `pnpm install` on a shop machine, no node_modules to keep in sync
  // with the build.
  ...(COUNTER_BUILD ? { output: "standalone" as const } : {}),
  // The AI SDK downloads image/file inputs through undici, loaded with a runtime
  // `createRequire(...)("undici")` the tracer cannot see — so standalone left it
  // out and every AI request with a photo failed "Cannot find module 'undici'" on
  // the counter. Pinned in package.json so this top-level path exists.
  outputFileTracingIncludes: { "/**": ["./node_modules/undici/**"] },
  experimental: {
    // `src/proxy.ts` now matches `/api` (for the counter's write relay), which makes
    // Next tee every non-GET API body for the proxy. The tee is capped at 10 MB by
    // default and OVERFLOWS SILENTLY — a console.warn, and the route handler receives
    // the first 10 MB of a bulk import. Lifted well past any real body.
    proxyClientMaxBodySize: "50mb",
    ...(COUNTER_BUILD
      ? {
          // Default true: the standalone server eagerly compiles+executes every
          // route entry (1300+ across pos/office/portal/shop/api) before it answers
          // its first request — measured ~7s of the counter app's ~15s cold start.
          // Off, boot only pays for Next's own core; each route instead compiles on
          // its own first hit. electron/main.ts's warmRoutes() then pre-hits the
          // routes a counter actually uses while the window is still painting, so
          // that lazy cost lands in time we're already spending, not in front of staff.
          preloadEntriesOnStart: true,
          // The standalone server lives inside the install folder, and on a "for
          // everyone" install that is Program Files — read-only to the cashier. Every
          // regenerated page then failed `mkdir .next\cache` with EPERM in main.log.
          // Off, Next keeps those pages in its in-memory cache only; the pages the
          // build prerendered are still read from disk as before.
          isrFlushToDisk: false,
        }
      : {}),
  },
  images: {
    // On the counter the optimizer is actively harmful, not merely useless: an
    // <Image> pointing at Cloudinary becomes a /_next/image request that makes the
    // COUNTER'S OWN Node server fetch Cloudinary. With no internet that hangs until
    // timeout and holds a server connection per image, so a product grid can stall
    // the whole page. The counter loader never calls /_next/image: Cloudinary photos
    // go straight to Cloudinary's resized copy, everything else is the raw URL.
    // Not `unoptimized` — that also discards the Cloudinary loader, so every photo
    // downloaded its full-size original (a phone HEIC one never showed at all).
    ...(COUNTER_BUILD ? { loader: "custom" as const, loaderFile: "./src/shared/lib/counterImageLoader.ts" } : {}),
    // Only the hosts we actually serve images from. A `**` wildcard here is an
    // open image-optimization proxy: anyone may call /_next/image with any URL
    // and spend our transformation quota on it. Most remote images (uploads,
    // avatars) are Cloudinary and go through Cloudinary's own loader (see
    // lib/cloudinaryImage.ts), bypassing this list entirely — but the shop's
    // stock hero/category art (storeContent.ts) and the login backdrop are
    // hardcoded Pexels URLs with no loader, so Pexels stays on the list too.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        ...(CLOUDINARY_CLOUD ? { pathname: `/${CLOUDINARY_CLOUD}/**` } : {}),
      },
      { protocol: "https", hostname: SUPABASE_HOST || "*.supabase.co" },
      { protocol: "https", hostname: "images.pexels.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
    // SVG stays OFF: the optimizer has had code-execution bugs on SVG input. Off, an
    // `<Image>` whose src ends in .svg is served as-is (next/image sets `unoptimized`
    // itself), so the logo and the ad placeholders still show.
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  // The internal build tells every crawler, on every response, not to index it.
  //
  // robots.txt is a request that a crawler may ignore, and it is not read at all
  // on a redirect — which is exactly what an anonymous hit on /office returns.
  // This header travels with the response itself, so the instruction arrives even
  // when no HTML (and therefore no <meta name="robots">) is rendered.
  //
  // The default-to-full fallback is deliberately the same as appMode's.
  async headers() {
    if (indexable) return []; // "public" mode only
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
  // Compatibility redirects for legacy URLs that pre-date the (route-group)/route
  // restructure. Catches stored notification links and stale bookmarks while the
  // source-code refs are migrated.
  async redirects() {
    // These all target /office/* — dead weight on any build with no /office routes.
    // office and counter both keep /office, so they keep the redirects too.
    if (!hasOfficeRoutes) return [];
    return [
      { source: "/office/tickets", destination: "/office/repairing/tickets", permanent: false },
      { source: "/office/tickets/:path*", destination: "/office/repairing/tickets/:path*", permanent: false },
      { source: "/office/companies", destination: "/office/customers/companies", permanent: false },
      { source: "/office/companies/:path*", destination: "/office/customers/companies/:path*", permanent: false },
      { source: "/office/dashboard", destination: "/office/repairing", permanent: false },
      // Compat: legacy /office/tally URLs (renamed to /office/accountancy 2026-05-07)
      { source: "/office/tally", destination: "/office/accountancy", permanent: false },
      { source: "/office/tally/:path*", destination: "/office/accountancy/:path*", permanent: false },
      // Compat: pipeline/status/sub-status settings moved out of repair into the settings module
      // (2026-05-07 → admin, 2026-05-20 → settings).
      { source: "/office/repairing/settings/pipelines", destination: "/office/settings/pipelines", permanent: false },
      { source: "/office/repairing/settings/pipelines/:path*", destination: "/office/settings/pipelines/:path*", permanent: false },
      { source: "/office/repairing/settings/statuses", destination: "/office/settings/statuses", permanent: false },
      { source: "/office/repairing/settings/statuses/:path*", destination: "/office/settings/statuses/:path*", permanent: false },
      { source: "/office/repairing/settings/sub-statuses", destination: "/office/settings/sub-statuses", permanent: false },
      { source: "/office/repairing/settings/sub-statuses/:path*", destination: "/office/settings/sub-statuses/:path*", permanent: false },
    ];
  },
};

// The counter artifact skips Sentry's build step entirely. Source-map upload reaches
// out to sentry.io and wants SENTRY_AUTH_TOKEN, which makes the one build we most
// need to be reproducible depend on the network. Runtime error reporting is
// unaffected — that is configured in sentry.*.config.ts, not here.
export default COUNTER_BUILD ? nextConfig : withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "network-service-rq",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  }
});
