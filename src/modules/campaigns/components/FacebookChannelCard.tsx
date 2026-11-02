"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Flag, Link2, Link2Off, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { startChannelConnect } from "../lib/startChannelConnect";

type Status = {
    setupProblem: string | null;
    connected: boolean;
    ready: boolean;
    fbUserName?: string | null;
    igUsername?: string | null;
    instagramReady?: boolean;
    pageName?: string | null;
    connectedByName?: string | null;
    lastError?: string | null;
};
type Page = { id: string; name: string; category: string | null; canPost: boolean };

/**
 * Campaigns → Channels: connect the shop's Facebook Page once (a page admin
 * signs in), then pick the page; its linked Instagram business account comes
 * with it. After that a post's Post to Facebook — and the
 * communications job at its scheduled time — put it up by themselves.
 */
export default function FacebookChannelCard() {
    const { data: session } = useSession();
    const canConnect = hasPermissionWithScope((session?.user as { permissions?: string[] } | undefined)?.permissions ?? [], PERMISSIONS.CAMPAIGNS_FACEBOOK_CONNECT);
    const [status, setStatus] = useState<Status | null>(null);
    const [pages, setPages] = useState<Page[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const loadPages = useCallback(async () => {
        setBusy("pages");
        try {
            setPages((await axios.get<{ pages: Page[] }>("/api/campaigns/facebook/pages")).data.pages);
        } catch (e) {
            toast.error(extractApiError(e, "Could not read your Facebook pages"));
        } finally {
            setBusy(null);
        }
    }, []);

    useEffect(() => {
        axios
            .get<Status>("/api/campaigns/facebook")
            .then(({ data }) => setStatus(data))
            .catch((e) => toast.error(extractApiError(e, "Could not load the Facebook connection")));
    }, []);

    // Back from Facebook's sign-in (?facebook=connected or a reason): say how it went,
    // then ask for the page. Read once from the address, then wiped from it.
    useEffect(() => {
        const result = new URLSearchParams(window.location.search).get("facebook");
        if (!result) return;
        window.history.replaceState(null, "", window.location.pathname);
        if (result === "connected") {
            toast.success("Facebook connected — now pick the shop's page");
            // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-shot result read off the URL (window.location) after mount; reading it during render would mismatch the server pass
            void loadPages();
        } else toast.error(result);
    }, [loadPages]);

    async function pick(p: Page) {
        setBusy(p.id);
        try {
            const { data } = await axios.put<Status>("/api/campaigns/facebook", { pageId: p.id });
            setStatus(data);
            setPages(null);
            toast.success(`Posts will go to ${p.name}`);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to save the page"));
        } finally {
            setBusy(null);
        }
    }

    async function disconnect() {
        if (!window.confirm("Disconnect Facebook? Posts go back to sharing by hand.")) return;
        setBusy("disconnect");
        try {
            setStatus((await axios.delete<Status>("/api/campaigns/facebook")).data);
            setPages(null);
            toast.success("Facebook disconnected");
        } catch (e) {
            toast.error(extractApiError(e, "Failed to disconnect"));
        } finally {
            setBusy(null);
        }
    }

    return (
        <section className="rounded-xl border border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20">
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                        {status?.ready && <Check className="h-4 w-4 text-emerald-600" />}
                        Facebook Page & Instagram — automatic posting
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        {!status
                            ? "Loading…"
                            : status.setupProblem
                              ? status.setupProblem
                              : !status.connected
                                ? "Not connected — posts are shared by hand. Connect with a Facebook account that is an admin of the shop's page."
                                : status.ready
                                  ? `Posting to ${status.pageName} as ${status.fbUserName ?? "Facebook"}${status.connectedByName ? ` · connected by ${status.connectedByName}` : ""}`
                                  : `Connected as ${status.fbUserName ?? "Facebook"} — pick the shop's page.`}
                    </p>
                    {status?.ready && (
                        <p className="text-xs text-muted-foreground">
                            {status.instagramReady
                                ? `Instagram: posting to @${status.igUsername ?? "linked account"} too`
                                : "Instagram: no business account is linked to this page — link it in Meta Business Suite, then press Reconnect and pick the page again."}
                        </p>
                    )}
                    {status?.lastError && <p className="mt-1 text-xs text-destructive">Last problem: {status.lastError}</p>}
                </div>
                {canConnect && status && !status.setupProblem && (
                    <div className="flex flex-wrap gap-1.5">
                        {/* A full page visit, not a fetch: Facebook's sign-in has to open in the browser. */}
                        <Button
                            size="sm"
                            variant={status.connected ? "outline" : "default"}
                            disabled={busy !== null}
                            onClick={() => startChannelConnect("/api/campaigns/facebook/connect", "Facebook sign-in")}
                        >
                            <Link2 className="mr-1 h-3.5 w-3.5" /> {status.connected ? "Reconnect" : "Connect"}
                        </Button>
                        {status.connected && (
                            <>
                                <Button size="sm" variant="outline" disabled={busy !== null} onClick={loadPages}>
                                    <Flag className="mr-1 h-3.5 w-3.5" /> {busy === "pages" ? "Reading…" : status.ready ? "Change page" : "Pick page"}
                                </Button>
                                <Button size="sm" variant="ghost" className="text-destructive" disabled={busy !== null} onClick={disconnect}>
                                    <Link2Off className="mr-1 h-3.5 w-3.5" /> Disconnect
                                </Button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {pages && (
                <div className="divide-y border-t">
                    {pages.length === 0 && (
                        <p className="px-4 py-3 text-xs text-muted-foreground">
                            This Facebook account manages no page, or the page was not ticked when allowing. Reconnect and tick the shop&apos;s page.
                        </p>
                    )}
                    {pages.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <div className="min-w-0">
                                <p className="text-sm font-medium">{p.name}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {p.canPost ? p.category ?? "Facebook Page" : "Your role on this page cannot create posts"}
                                </p>
                            </div>
                            <Button size="sm" disabled={busy !== null || !p.canPost} onClick={() => pick(p)}>
                                {busy === p.id ? <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : null} Use this
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
