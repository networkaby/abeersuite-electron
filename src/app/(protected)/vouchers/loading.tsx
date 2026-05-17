import { Skeleton } from "@/components/ui/skeleton";

// Full-page voucher form skeleton (GL/inventory voucher edit pages — no office sidebar).
export default function Loading() {
    return (
        <div className="fixed inset-0 flex flex-col overflow-hidden bg-background">
            {/* top bar */}
            <div className="flex items-center justify-between border-b border-border px-6 py-3">
                <Skeleton className="h-6 w-40" />
                <div className="flex gap-2">
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-8 w-24" />
                </div>
            </div>
            {/* form body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="space-y-1.5">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-9 w-full" />
                        </div>
                    ))}
                </div>
                <div className="rounded-lg border border-border overflow-hidden">
                    <Skeleton className="h-10 w-full rounded-none" />
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full rounded-none border-t border-border" />
                    ))}
                </div>
                <div className="flex justify-end gap-3">
                    <Skeleton className="h-9 w-24" />
                    <Skeleton className="h-9 w-32" />
                </div>
            </div>
        </div>
    );
}
