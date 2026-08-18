import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  // Tracing runs inside every server invocation, so the sample rate is a direct
  // dial on compute spend. 5% still shows the shape of a slow route.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1 : 0.05,
});
