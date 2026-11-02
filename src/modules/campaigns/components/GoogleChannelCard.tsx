"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Link2, Link2Off, MapPin, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { startChannelConnect } from "../lib/startChannelConnect";

type Status = {
    setupProblem: string | null;
    connected: boolean;
    ready: boolean;
    googleEmail?: string | null;
    locationTitle?: string | null;
    connectedByName?: string | null;
    lastError?: string | null;
};
type Location = { accountName: string; locationName: string; title: string; address: string | null };

/**
 * Campaigns → Channels: connect the shop's Google Business Profile once, then
 * pick the listing. After that a post's Post to Google — and the communications
 * job at its scheduled time — put it up without anyone copying and pasting.
 */
export default function GoogleChannelCard() {
    const { data: session } = useSession();
    const canConnect = hasPermissionWithScope((session?.user as { permissions?: string[] } | undefined)?.permissions ?? [], PERMISSIONS.CAMPAIGNS_GOOGLE_CONNECT);
    const [status, setStatus] = useState<Status | null>(null);
    const [locations, setLocations] = useState<Location[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const loadLocations = useCallback(async () => {
        setBusy("locations");
        try {
            setLocations((await axios.get<{ locations: Location[] }>("/api/campaigns/google/locations")).data.locations);
        } catch (e) {
            toast.error(extractApiError(e, "Could not read your Google listings"));
        } finally {
            setBusy(null);
        }
    }, []);

    useEffect(() => {
        axios
            .get<Status>("/api/campaigns/google")
            .then(({ data }) => setStatus(data))
            .catch((e) => toast.error(extractApiError(e, "Could not load the Google connection")));
    }, []);

    // Back from Google's sign-in (?google=connected or a reason): say how it went,
    // then ask for the listing. Read once from the address, then wiped from it.
    useEffect(() => {
        const result = new URLSearchParams(window.location.search).get("google");
        if (!result) return;
        window.history.replaceState(null, "", window.location.pathname);
        if (result === "connected") {
            toast.success("Google connected — now pick the shop's listing");
            // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-shot result read off the URL (window.location) after mount; reading it during render would mismatch the server pass
            void loadLocations();
        } else toast.error(result);
    }, [loadLocations]);

    async function pick(l: Location) {
        setBusy(l.locationName);
        try {
            const { data } = await axios.put<Status>("/api/campaigns/google", { accountName: l.accountName, locationName: l.locationName, locationTitle: l.title });
            setStatus(data);
            setLocations(null);
            toast.success(`Posts will go to ${l.title}`);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to save the listing"));
        } finally {
            setBusy(null);
        }
    }

    async function disconnect() {
        if (!window.confirm("Disconnect Google? Posts go back to sharing by hand.")) return;
        setBusy("disconnect");
        try {
            setStatus((await axios.delete<Status>("/api/campaigns/google")).data);
            setLocations(null);
            toast.success("Google disconnected");
        } catch (e) {
            toast.error(extractApiError(e, "Failed to disconnect"));
        } finally {
            setBusy(null);
        }
    }

    return (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20">
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                        {status?.ready && <Check className="h-4 w-4 text-emerald-600" />}
                        Google Business Profile — automatic posting
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        {!status
                            ? "Loading…"
                            : status.setupProblem
                              ? status.setupProblem
                              : !status.connected
                                ? "Not connected — posts are shared by hand. Connect with the Google account that owns the listing."
                                : status.ready
                                  ? `Posting to ${status.locationTitle} as ${status.googleEmail ?? "Google"}${status.connectedByName ? ` · connected by ${status.connectedByName}` : ""}`
                                  : `Connected as ${status.googleEmail ?? "Google"} — pick the shop's listing.`}
                    </p>
                    {status?.lastError && <p className="mt-1 text-xs text-destructive">Last problem: {status.lastError}</p>}
                </div>
                {canConnect && status && !status.setupProblem && (
                    <div className="flex flex-wrap gap-1.5">
                        {/* A full page visit, not a fetch: Google's sign-in has to open in the browser. */}
                        <Button
                            size="sm"
                            variant={status.connected ? "outline" : "default"}
                            disabled={busy !== null}
                            onClick={() => startChannelConnect("/api/campaigns/google/connect", "Google sign-in")}
                        >
                            <Link2 className="mr-1 h-3.5 w-3.5" /> {status.connected ? "Reconnect" : "Connect"}
                        </Button>
                        {status.connected && (
                            <>
                                <Button size="sm" variant="outline" disabled={busy !== null} onClick={loadLocations}>
                                    <MapPin className="mr-1 h-3.5 w-3.5" /> {busy === "locations" ? "Reading…" : status.ready ? "Change listing" : "Pick listing"}
                                </Button>
                                <Button size="sm" variant="ghost" className="text-destructive" disabled={busy !== null} onClick={disconnect}>
                                    <Link2Off className="mr-1 h-3.5 w-3.5" /> Disconnect
                                </Button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {locations && (
                <div className="divide-y border-t">
                    {locations.length === 0 && (
                        <p className="px-4 py-3 text-xs text-muted-foreground">
                            This Google account manages no listing. Reconnect with the account that owns the shop on business.google.com.
                        </p>
                    )}
                    {locations.map((l) => (
                        <div key={l.locationName} className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <div className="min-w-0">
                                <p className="text-sm font-medium">{l.title}</p>
                                {l.address && <p className="truncate text-xs text-muted-foreground">{l.address}</p>}
                            </div>
                            <Button size="sm" disabled={busy !== null} onClick={() => pick(l)}>
                                {busy === l.locationName ? <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : null} Use this
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
