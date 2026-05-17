import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between">
                <Skeleton className="h-7 w-48" />
                <div className="flex gap-2">
                    <Skeleton className="h-8 w-36" />
                    <Skeleton className="h-8 w-36" />
                    <Skeleton className="h-8 w-24" />
                </div>
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
                <Skeleton className="h-10 w-full rounded-none" />
                {Array.from({ length: 12 }).map((_, i) => (
                    <Skeleton key={i} className="h-11 w-full rounded-none border-t border-border" />
                ))}
            </div>
        </div>
    );
}
