"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    readPushState,
    refreshPushSubscription,
    turnPushOff,
    turnPushOn,
    type PushState,
} from "@/modules/external/pwa/pushClient";

/**
 * "Bill & receipt notifications" — the customer's on/off switch for this
 * device. `compact` (portal home) shows only while notifications are off, as an
 * invitation; the full card (My Profile) always shows, with the off switch.
 */
export default function PortalPushCard({ compact = false }: { compact?: boolean }) {
    const [state, setState] = useState<PushState | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        readPushState().then((s) => {
            if (!alive) return;
            setState(s);
            if (s === "on") void refreshPushSubscription();
        });
        return () => {
            alive = false;
        };
    }, []);

    if (state === null || state === "unsupported") return null;
    if (compact && state === "on") return null;

    const toggle = async () => {
        setBusy(true);
        try {
            const next = state === "on" ? await turnPushOff() : await turnPushOn();
            setState(next);
            if (next === "on") toast.success("Notifications are on for this phone.");
            else if (next === "denied") toast.error("Notifications are blocked. Allow them in your phone's settings for this app.");
        } catch {
            toast.error("Could not change notifications. Please try again.");
        } finally {
            setBusy(false);
        }
    };

    const on = state === "on";
    return (
        <Card className="border-border/70">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-start gap-3">
                    {on ? (
                        <Bell className="mt-0.5 size-5 shrink-0 text-primary" />
                    ) : (
                        <BellOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                    )}
                    <div>
                        <p className="text-sm font-medium">Bill &amp; receipt notifications</p>
                        <p className="text-xs text-muted-foreground">
                            {on
                                ? "Your bills and receipts arrive on this phone as notifications."
                                : state === "denied"
                                  ? "Blocked on this phone. Allow notifications for this app in your phone's settings."
                                  : "Get your bills and receipts on this phone as soon as they are made."}
                        </p>
                    </div>
                </div>
                {state !== "denied" && (
                    <Button size="sm" variant={on ? "outline" : "default"} disabled={busy} onClick={toggle}>
                        {on ? "Turn off" : "Turn on"}
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}
