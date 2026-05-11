"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useCreditNoteDialogStore } from "@/store/creditNoteDialogStore";

export default function NewCreditNoteRoute() {
    const router = useRouter();
    const { open, setOpen } = useCreditNoteDialogStore();
    const opened = useRef(false);

    useEffect(() => {
        setOpen(true);
    }, [setOpen]);

    useEffect(() => {
        if (open) opened.current = true;
        else if (opened.current) router.push("/office/accountancy/credit-notes");
    }, [open, router]);

    return (
        <div className="py-20 text-center text-sm text-muted-foreground">
            Opening credit note dialog…
        </div>
    );
}
