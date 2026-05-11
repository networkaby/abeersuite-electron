"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePurchaseDialogStore } from "@/store/purchaseDialogStore";

export default function NewPurchaseRoute() {
    const router = useRouter();
    const { open, setOpen } = usePurchaseDialogStore();
    const opened = useRef(false);

    useEffect(() => {
        setOpen(true);
    }, [setOpen]);

    useEffect(() => {
        if (open) opened.current = true;
        else if (opened.current) router.push("/office/accountancy/purchases");
    }, [open, router]);

    return (
        <div className="py-20 text-center text-sm text-muted-foreground">
            Opening purchase dialog…
        </div>
    );
}
