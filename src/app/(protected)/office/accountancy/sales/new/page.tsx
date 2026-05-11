"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSaleDialogStore } from "@/store/saleDialogStore";

export default function NewSaleRoute() {
    const router = useRouter();
    const { open, setOpen } = useSaleDialogStore();
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
            Opening sale dialog…
        </div>
    );
}
