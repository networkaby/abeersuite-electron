"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useEstimateDialogStore } from "@/store/estimateDialogStore";

export default function NewEstimateRoute() {
    const router = useRouter();
    const { open, setOpen } = useEstimateDialogStore();
    const opened = useRef(false);

    useEffect(() => {
        setOpen(true);
    }, [setOpen]);

    useEffect(() => {
        if (open) opened.current = true;
        else if (opened.current) router.push("/office/accountancy/estimates");
    }, [open, router]);

    return (
        <div className="py-20 text-center text-sm text-muted-foreground">
            Opening estimate dialog…
        </div>
    );
}
