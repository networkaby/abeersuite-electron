import * as Sentry from "@sentry/nextjs";
import { parseCounterPc } from "@/shared/lib/appModeCore";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // Counter only: electron/main.ts sets LOCAL_DATABASE_URL AND COUNTER_PC=true
    // together, and only once the embedded replica actually provisioned. Both are
    // required here on purpose: a LOCAL_DATABASE_URL on its own — a leftover in a
    // developer's .env, or copied into a hosted deployment by mistake — must not start
    // a flusher that then knocks on a database that is not there every five seconds.
    // On Vercel and on an ordinary laptop nothing starts, and the server behaves
    // exactly as it always has.
    //
    // The flusher lives in this process rather than in Electron because pushing needs
    // the Supabase client, which is here — see flusher.ts for the 401 that made the
    // previous cross-process arrangement never work once.
    const localUrl = process.env.LOCAL_DATABASE_URL;
    if (localUrl && parseCounterPc(process.env.COUNTER_PC) === true) {
      const { startOutboxFlusher } = await import("@/shared/lib/sync/flusher");
      startOutboxFlusher(localUrl);
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
