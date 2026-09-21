"use client";

// The old group detail page is gone — Group Report shows the same group with
// opening / debit / credit / closing for a period, and one read feeds it.
// This route stays only so an old bookmark or a stale link still lands
// somewhere sensible; it forwards, carrying the period along.

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { groupReportUrl } from "@/modules/accountancy/lib/groupReportUrl";

export default function GroupDetailRedirectPage() {
    const router = useRouter();
    const search = useSearchParams();
    const { id } = useParams<{ id: string }>();

    useEffect(() => {
        router.replace(groupReportUrl(Number(id), {
            from: search.get("from") ?? undefined,
            to:   search.get("to")   ?? undefined,
            asOf: search.get("asOf") ?? undefined,
        }));
    }, [id, search, router]);

    return (
        <div className="flex h-64 items-center justify-center">
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
        </div>
    );
}
