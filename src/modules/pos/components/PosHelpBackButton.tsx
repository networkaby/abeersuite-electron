"use client";

// The counter help page's way out — the button and Esc. Help normally opens in
// its own window, which this closes; reached in the POS window itself (a
// blocked popup), it steps back, and with no history it goes to the register.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { POS_HELP_URL } from "@/modules/pos/lib/posHelp";

const POS_URL = POS_HELP_URL.replace(/\/help$/, "");

export function PosHelpBackButton() {
    const router = useRouter();

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !e.defaultPrevented) leave();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    function leave() {
        if (window.history.length > 1) { router.back(); return; }
        window.close();
        // Still here — the window was not script-opened, so it cannot close itself.
        setTimeout(() => router.replace(POS_URL), 150);
    }

    return (
        <Button variant="outline" size="sm" onClick={leave} title="Back to POS (Esc)">
            <ArrowLeft className="size-4" /> Back to POS
        </Button>
    );
}
