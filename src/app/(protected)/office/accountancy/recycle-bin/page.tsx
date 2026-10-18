"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RecycleBin } from "@/modules/accountancy/components/RecycleBin";
import { ActivityLog } from "@/modules/accountancy/components/ActivityLog";

// Two tabs: the bin itself, and Activity (who created / edited / deleted which
// voucher). The tab lives in the URL so a refresh or a shared link keeps it.
export default function RecycleBinPage() {
    return <Suspense><RecycleBinTabs /></Suspense>;
}

function RecycleBinTabs() {
    const router = useRouter();
    const tab = useSearchParams().get("tab") === "activity" ? "activity" : "bin";
    const tabCls = (on: boolean) =>
        `border-b-2 px-3 py-2 text-sm ${on ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-card">
            <div className="flex gap-1 border-b px-4">
                <button type="button" className={tabCls(tab === "bin")} onClick={() => router.replace("?")}>Recycle Bin</button>
                <button type="button" className={tabCls(tab === "activity")} onClick={() => router.replace("?tab=activity")}>Activity</button>
            </div>
            <div className="min-h-0 flex-1">
                {tab === "activity" ? <ActivityLog /> : <RecycleBin />}
            </div>
        </div>
    );
}
