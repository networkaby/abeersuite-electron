import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-5 w-24" />
            </div>
            <div className="rounded-lg border border-border bg-card p-4 shadow space-y-3">
                <Skeleton className="h-9 w-full" />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-9 w-full" />
                    ))}
                </div>
            </div>
            <div className="rounded-lg border border-border shadow overflow-hidden">
                <Skeleton className="h-10 w-full rounded-none" />
                {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-none border-t border-border" />
                ))}
            </div>
        </div>
    );
}
