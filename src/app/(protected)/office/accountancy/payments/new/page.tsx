"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePaymentDialogStore } from "@/store/paymentDialogStore";

export default function NewPaymentRoute() {
    const router = useRouter();
    const { open, setOpen } = usePaymentDialogStore();
    const opened = useRef(false);

    useEffect(() => {
        setOpen(true);
    }, [setOpen]);

    useEffect(() => {
        if (open) opened.current = true;
        else if (opened.current) router.push("/office/accountancy/payments");
    }, [open, router]);

    return (
        <div className="py-20 text-center text-sm text-muted-foreground">
            Opening payment dialog…
        </div>
    );
}
