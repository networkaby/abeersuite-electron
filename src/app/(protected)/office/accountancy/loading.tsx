import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
    return (
        // Matches the px-6 pt-3 every real accountancy page uses — without it the
        // skeleton sat flush left and the whole route jumped sideways when the
        // content landed. The filter card is translucent so the module wash is
        // visible while loading rather than an opaque slab.
        <div className="space-y-5 px-6 pt-3">
            <div className="flex items-center justify-between">
                <div className="space-y-1.5">
                    <Skeleton className="h-7 w-52" />
                    <Skeleton className="h-4 w-72" />
                </div>
                <Skeleton className="h-8 w-24" />
            </div>
            <div className="rounded-lg border border-border bg-card/70 p-4 space-y-3">
                <div className="flex flex-wrap gap-3">
                    <Skeleton className="h-8 w-36" />
                    <Skeleton className="h-8 w-36" />
                    <Skeleton className="h-8 w-44" />
                    <Skeleton className="h-8 w-48" />
                </div>
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
                <Skeleton className="h-10 w-full rounded-none" />
                {Array.from({ length: 10 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-none border-t border-border" />
                ))}
            </div>
        </div>
    );
}
