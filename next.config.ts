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
      // Compat: pipeline/status/sub-status settings moved out of repair into admin module 2026-05-07
      { source: "/office/repairing/settings/pipelines", destination: "/office/pipelines", permanent: false },
      { source: "/office/repairing/settings/pipelines/:path*", destination: "/office/pipelines/:path*", permanent: false },
      { source: "/office/repairing/settings/statuses", destination: "/office/statuses", permanent: false },
      { source: "/office/repairing/settings/statuses/:path*", destination: "/office/statuses/:path*", permanent: false },
      { source: "/office/repairing/settings/sub-statuses", destination: "/office/sub-statuses", permanent: false },
      { source: "/office/repairing/settings/sub-statuses/:path*", destination: "/office/sub-statuses/:path*", permanent: false },
      // Compat: pre-existing /office/settings/* sidebar URLs that pointed at non-existent pages
      { source: "/office/settings/pipelines", destination: "/office/pipelines", permanent: false },
      { source: "/office/settings/statuses", destination: "/office/statuses", permanent: false },
      { source: "/office/settings/sub-statuses", destination: "/office/sub-statuses", permanent: false },
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
