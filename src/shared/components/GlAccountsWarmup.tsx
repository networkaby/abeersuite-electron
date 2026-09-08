"use client";

import { useEffect } from "react";
import { servedByReplica } from "@/shared/lib/browser/localDb";
import { warmGlAccounts } from "@/shared/hooks/useGlAccounts";

/**
 * Loads the chart of accounts into memory at app start on a replica-served
 * counter (the local app), so the first voucher of the day opens with its
 * particulars list ready. The web version is left alone: there the list is
 * read when a voucher opens, from the same shared store.
 */
export default function GlAccountsWarmup() {
    useEffect(() => {
        if (servedByReplica()) warmGlAccounts();
    }, []);
    return null;
}
