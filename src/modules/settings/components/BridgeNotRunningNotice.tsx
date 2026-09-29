"use client";

import { GatedLink } from "@/shared/components/GatedLink";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

// Shown on the Thermal Printer / QR Display pages when the local bridge relay
// isn't reachable. Points the user to the shared Downloads page (the bridge
// powers both, and may carry other tools later) instead of duplicating the
// download links on each page.
export function BridgeNotRunningNotice({ device = "bridge" }: { device?: string }) {
    return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-2">
            <p className="font-medium">The Counter Bridge isn&apos;t running on this PC</p>
            <p className="text-xs text-amber-700">
                Install it (or start it) to use the {device}. Get the installer and setup steps from the Downloads page.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-1 border-amber-300 bg-white">
                <GatedLink href="/office/settings/downloads">
                    <Download size={14} /> Go to Downloads
                </GatedLink>
            </Button>
        </div>
    );
}
