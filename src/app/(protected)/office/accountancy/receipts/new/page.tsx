"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useReceiptDialogStore } from "@/store/receiptDialogStore";

export default function NewReceiptRoute() {
    const router = useRouter();
    const { open, setOpen } = useReceiptDialogStore();
    const opened = useRef(false);

    useEffect(() => {
        setOpen(true);
    }, [setOpen]);

    useEffect(() => {
        if (open) opened.current = true;
        else if (opened.current) router.push("/office/accountancy/receipts");
    }, [open, router]);

    return (
        <div className="py-20 text-center text-sm text-muted-foreground">
            Opening receipt dialog…
        </div>
    );
}
