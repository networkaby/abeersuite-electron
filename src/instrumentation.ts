import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // Counter only: LOCAL_DATABASE_URL is set by electron/main.ts, and only when the
    // replica actually provisioned. On Vercel and on an ordinary laptop this is
    // absent, nothing starts, and the server behaves exactly as it always has.
    //
    // The flusher lives in this process rather than in Electron because pushing needs
    // the Supabase client, which is here — see flusher.ts for the 401 that made the
    // previous cross-process arrangement never work once.
    const localUrl = process.env.LOCAL_DATABASE_URL;
    if (localUrl) {
      const { startOutboxFlusher } = await import("@/shared/lib/sync/flusher");
      startOutboxFlusher(localUrl);
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
