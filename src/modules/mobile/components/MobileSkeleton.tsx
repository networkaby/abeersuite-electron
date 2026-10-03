/**
 * Grey stand-in rows, shown the instant a phone screen is tapped (the route's
 * loading.tsx) and while a list's first page is on its way — so a tap always
 * answers at once, the way an installed app does, instead of the old screen
 * sitting still until the new one arrives.
 */
export function MobileSkeletonRows({ count = 8 }: { count?: number }) {
    return (
        <ul className="divide-y" aria-hidden>
            {Array.from({ length: count }, (_, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-3">
                    <span className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
                    <span className="flex-1 space-y-2">
                        <span className="block h-3.5 w-2/3 animate-pulse rounded bg-muted" />
                        <span className="block h-3 w-1/3 animate-pulse rounded bg-muted" />
                    </span>
                    <span className="h-3.5 w-14 animate-pulse rounded bg-muted" />
                </li>
            ))}
        </ul>
    );
}

/** A whole screen's stand-in: an empty top bar of the real height, then rows. */
export default function MobileSkeleton() {
    return (
        <div role="status" aria-label="Loading">
            <div className="sticky top-0 z-10 flex h-[var(--m-header)] items-center gap-3 border-b bg-background px-4 pt-[env(safe-area-inset-top)]">
                <span className="size-6 animate-pulse rounded bg-muted" />
                <span className="h-4 w-36 animate-pulse rounded bg-muted" />
            </div>
            <MobileSkeletonRows />
        </div>
    );
}
