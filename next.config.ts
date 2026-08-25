import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Set only when building the artifact that runs ON a shop counter PC (localhost:3000
// against a local Postgres replica). Unset everywhere else, so the Vercel build below
// is byte-identical to what it has always produced.
const COUNTER_BUILD = process.env.COUNTER_BUILD === "1";

const nextConfig: NextConfig = {
  // Standalone traces the server and its deps into one folder we can copy onto the
  // counter — no `pnpm install` on a shop machine, no node_modules to keep in sync
  // with the build.
  ...(COUNTER_BUILD ? { output: "standalone" as const } : {}),
  ...(COUNTER_BUILD
    ? {
        experimental: {
          // Default true: the standalone server eagerly compiles+executes every
          // route entry (1300+ across pos/office/portal/shop/api) before it answers
          // its first request — measured ~7s of the counter app's ~15s cold start.
          // Off, boot only pays for Next's own core; each route instead compiles on
          // its own first hit. electron/main.ts's warmRoutes() then pre-hits the
          // routes a counter actually uses while the window is still painting, so
          // that lazy cost lands in time we're already spending, not in front of staff.
          preloadEntriesOnStart: false,
        },
      }
    : {}),
  images: {
    // On the counter the optimizer is actively harmful, not merely useless: an
    // <Image> pointing at Cloudinary becomes a /_next/image request that makes the
    // COUNTER'S OWN Node server fetch Cloudinary. With no internet that hangs until
    // timeout and holds a server connection per image, so a product grid can stall
    // the whole page. Unoptimized emits the raw URL instead — the browser fails fast
    // and the component's onError placeholder shows.
    unoptimized: COUNTER_BUILD,
    // Only the hosts we actually serve images from. A `**` wildcard here is an
    // open image-optimization proxy: anyone may call /_next/image with any URL
    // and spend our transformation quota on it. Most remote images (uploads,
    // avatars) are Cloudinary and go through Cloudinary's own loader (see
    // lib/cloudinaryImage.ts), bypassing this list entirely — but the shop's
    // stock hero/category art (storeContent.ts) and the login backdrop are
    // hardcoded Pexels URLs with no loader, so Pexels stays on the list too.
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "images.pexels.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
    dangerouslyAllowSVG: true,
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
  // Reads APP_MODE directly rather than importing lib/appMode: next.config runs
  // outside the app's module graph, and appMode pulls in the company constants.
  // The default-to-full fallback is deliberately the same as appMode's.
  async headers() {
    if (process.env.APP_MODE === "public") return [];
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
    // These all target /office/* — dead weight on the public build, which has
    // no /office routes to redirect into.
    if (process.env.APP_MODE === "public") return [];
    return [
      { source: "/office/tickets", destination: "/office/repairing/tickets", permanent: false },
      { source: "/office/tickets/:path*", destination: "/office/repairing/tickets/:path*", permanent: false },
      { source: "/office/companies", destination: "/office/customers/companies", permanent: false },
      { source: "/office/companies/:path*", destination: "/office/customers/companies/:path*", permanent: false },
      { source: "/office/service-centers", destination: "/office/repairing/service-centers", permanent: false },
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
