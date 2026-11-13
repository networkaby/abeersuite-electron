"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Closes a help tab opened from App Settings; a browser that refuses goes back to the page instead. */
export function CloseTabButton() {
    const router = useRouter();
    const close = () => {
        window.close();
        // window.close() is ignored for a tab the user opened by hand — fall back.
        setTimeout(() => {
            if (!window.closed) router.push("/office/settings/app-settings");
        }, 150);
    };
    return (
        <Button variant="outline" size="sm" onClick={close}>
            <X size={14} className="mr-1" /> Close
        </Button>
    );
}
