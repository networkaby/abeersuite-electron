"use client";

import { useState } from "react";
import UniversalHelperSearch from "@/modules/lab/components/UniversalHelperSearch";
import QuickActionTiles from "@/modules/lab/components/QuickActionTiles";
import QuickTicketDialog from "@/modules/lab/components/QuickTicketDialog";
import TodaysPulse from "@/modules/lab/components/TodaysPulse";

export default function LabFrontOfficePage() {
    const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
    // Bumped on every successful ticket create so child feeds can refresh if
    // they choose to listen. (TodaysPulse currently fetches once on mount —
    // a follow-up could subscribe to this counter.)
    const [, setRefreshKey] = useState(0);

    return (
        <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
            {/* HERO — universal search */}
            <section>
                <h1 className="mb-1 text-2xl font-semibold text-foreground">
                    Front Office
                </h1>
                <p className="mb-4 text-sm text-muted-foreground">
                    Help any customer in front of you — search, lookup, log,
                    create.
                </p>
                <UniversalHelperSearch />
            </section>

            {/* QUICK ACTIONS */}
            <QuickActionTiles onNewTicket={() => setTicketDialogOpen(true)} />

            {/* TODAY'S PULSE */}
            <TodaysPulse />

            {/* DIALOGS */}
            <QuickTicketDialog
                open={ticketDialogOpen}
                onOpenChange={setTicketDialogOpen}
                onCreated={() => setRefreshKey((k) => k + 1)}
            />
        </div>
    );
}
