import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
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
  // The default-to-office fallback is deliberately the same as appMode's.
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

export default withSentryConfig(nextConfig, {
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
