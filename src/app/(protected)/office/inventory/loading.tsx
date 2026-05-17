import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between">
                <div className="space-y-1.5">
                    <Skeleton className="h-7 w-48" />
                    <Skeleton className="h-4 w-64" />
                </div>
                <Skeleton className="h-9 w-28" />
            </div>
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex flex-wrap gap-3">
                    <Skeleton className="h-8 w-52" />
                    <Skeleton className="h-8 w-36" />
                    <Skeleton className="h-8 w-36" />
                </div>
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
                <Skeleton className="h-10 w-full rounded-none" />
                {Array.from({ length: 10 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-none border-t border-border" />
                ))}
            </div>
        </div>
    );
}
