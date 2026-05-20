import { Skeleton } from "@/components/ui/skeleton";

// Nav tabs are rendered by the layout (AdminNav) and stay visible during navigation.
// This skeleton only covers the content area below the tabs.
export default function Loading() {
    return (
        <div className="space-y-3 mt-4">
            <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
                <Skeleton className="h-8 w-36" />
                <Skeleton className="h-8 w-36" />
                <Skeleton className="h-8 w-44" />
                <Skeleton className="h-8 w-32 ml-auto" />
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
                <Skeleton className="h-10 w-full rounded-none" />
                {Array.from({ length: 12 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-none border-t border-border" />
                ))}
            </div>
        </div>
    );
}
