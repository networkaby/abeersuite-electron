"use client";

import { useRouter } from "next/navigation";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import type { Topic } from "@/shared/lib/realtime/topics";

/**
 * Re-render a SERVER component's page when the data behind it moves.
 *
 * The office home page is an `async` server component: its briefing cards are
 * computed on the server per request, so there is no `load()` to call again from the
 * browser. `router.refresh()` is the App Router's way to ask for a fresh server
 * render of the current route without touching client state — same settle window
 * and hidden-tab behaviour as every other live surface, via `useRealtimeTopics`.
 *
 * Renders nothing. Mount it once inside the page.
 */
export default function LiveRefresh({ topics }: { topics: readonly Topic[] }) {
    const router = useRouter();
    useRealtimeTopics(topics, () => router.refresh());
    return null;
}
