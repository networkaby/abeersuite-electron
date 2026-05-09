"use client";

// Thin route wrapper — the actual UI lives in the globally-mounted
// JournalVoucherDialog. Visiting this URL just opens the dialog and
// navigates back to the accountancy hub when it closes, so the dialog
// remains reachable from anywhere via the Zustand store.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useJournalVoucherStore } from "@/store/journalVoucherStore";

export default function NewJournalVoucherRoute() {
    const router = useRouter();
    const { open, setOpen } = useJournalVoucherStore();
    const opened = useRef(false);

    useEffect(() => {
        setOpen(true);
    }, [setOpen]);

    useEffect(() => {
        if (open) opened.current = true;
        else if (opened.current) router.push("/office/accountancy/");
    }, [open, router]);

    return (
        <div className="text-center py-20 text-sm text-muted-foreground">
            Opening journal voucher…
        </div>
    );
}
