// Client navigation for the "navigate" Action tool. An in-app path ("/…") uses the
// Next App-Router (SPA push, no reload); an absolute URL falls back to a full load.
// Shared by WorkActions + StatusNav so the navigate effect behaves identically wherever
// an Action chain resolves inside a user gesture.
import type { useRouter } from "next/navigation";

type AppRouter = ReturnType<typeof useRouter>;

export function navigateInApp(router: AppRouter, target: string): void {
    const t = target.trim();
    if (!t) return;
    if (/^https?:\/\//i.test(t)) { window.location.assign(t); return; }
    router.push(t);
}
