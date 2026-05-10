"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useContraDialogStore } from "@/store/contraDialogStore";

export default function NewContraRoute() {
    const router = useRouter();
    const { open, setOpen } = useContraDialogStore();
    const opened = useRef(false);

    useEffect(() => {
        setOpen(true);
    }, [setOpen]);

    useEffect(() => {
        if (open) opened.current = true;
        else if (opened.current) router.push("/office/accountancy/contras");
    }, [open, router]);

    return (
        <div className="py-20 text-center text-sm text-muted-foreground">
            Opening contra dialog…
        </div>
    );
}
