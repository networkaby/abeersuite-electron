"use client";

/**
 * EXPLORATORY route — opens the parallel full-screen Sale dialog so we can
 * compare its layout (max-w-[95vw] / h-[95vh]) against the live dialog
 * (`/office/accountancy/sales/new`) on the same DB / data. Remove together
 * with TradingVoucherFullScreenForm once the layout direction is decided.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSaleFullScreenDialogStore } from "@/store/saleFullScreenDialogStore";

export default function NewSaleFullScreenRoute() {
    const router = useRouter();
    const { open, setOpen } = useSaleFullScreenDialogStore();
    const opened = useRef(false);

    useEffect(() => {
        setOpen(true);
    }, [setOpen]);

    useEffect(() => {
        if (open) opened.current = true;
        else if (opened.current) router.push("/office/accountancy/sales");
    }, [open, router]);

    return (
        <div className="py-20 text-center text-sm text-muted-foreground">
            Opening sale dialog (full-screen experiment)…
        </div>
    );
}
