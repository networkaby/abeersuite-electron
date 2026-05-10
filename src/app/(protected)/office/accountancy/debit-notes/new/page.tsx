"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDebitNoteDialogStore } from "@/store/debitNoteDialogStore";

export default function NewDebitNoteRoute() {
    const router = useRouter();
    const { open, setOpen } = useDebitNoteDialogStore();
    const opened = useRef(false);

    useEffect(() => {
        setOpen(true);
    }, [setOpen]);

    useEffect(() => {
        if (open) opened.current = true;
        else if (opened.current) router.push("/office/accountancy/debit-notes");
    }, [open, router]);

    return (
        <div className="py-20 text-center text-sm text-muted-foreground">
            Opening debit note dialog…
        </div>
    );
}
