"use client";

/**
 * Settings → Backup & Restore → Databases: DB1 / DB2, which is primary, the nightly copy
 * into staging, and the Switch button.
 *
 * Hidden on a counter or without settings:manage. With one database it still shows, so
 * the owner can see which of DATABASE_URL_1/_2, DIRECT_URL_1/_2 this deployment has.
 * The button opens only in the window the server allows (after a good nightly copy,
 * before 8 AM IST); the server checks again, and compares both databases, before it
 * switches — the button state is a convenience, not the guard.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Database, RefreshCw, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

/** Mirrors DbSwitchStatus in shared/lib/db/dbSwitch.server.ts (client cannot import it). */
interface DbInfo {
    id: "DB1" | "DB2";
    role: "primary" | "staging";
    projectRef: string;
    reachable: boolean;
    readOnly: boolean | null;
}
interface Status {
    dual: boolean;
    primary: string;
    staging: string | null;
    dbs: DbInfo[];
    copy: { startedAt: string | null; copiedAt: string | null; failedAt: string | null; into: string | null; file: string | null };
    window: { open: boolean; until: string | null; reason: string | null };
    envKeys: { key: string; set: boolean }[];
}

const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

/** null on a counter, without permission, or on a network error — the card then stays hidden. */
async function fetchStatus(): Promise<Status | null> {
    try {
        const res = await fetch("/api/settings/db-switch", { cache: "no-store" });
        return res.ok ? ((await res.json()) as Status) : null;
    } catch {
        return null;
    }
}

export function DatabaseSwitchCard() {
    const [status, setStatus] = useState<Status | null>(null);
    const [loading, setLoading] = useState(false);
    const [typed, setTyped] = useState("");
    const [switching, setSwitching] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const next = await fetchStatus();
            if (next) setStatus(next);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchStatus().then((next) => {
            if (next) setStatus(next);
        });
    }, []);

    if (!status) return null;

    const keyList = (
        <p className="text-[11px] text-muted-foreground">
            {status.envKeys.map((k, i) => (
                <span key={k.key}>
                    {i > 0 && " · "}
                    <span className="font-mono">{k.key}</span>{" "}
                    <span className={k.set ? "text-emerald-600" : "text-muted-foreground/70"}>{k.set ? "set" : "not set"}</span>
                </span>
            ))}
        </p>
    );

    if (!status.dual) {
        return (
            <section className="space-y-2 rounded-lg border bg-card p-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Database className="size-4" /> Databases
                </h2>
                <p className="text-xs text-muted-foreground">
                    Only one database is set up, so there is no staging copy and no switch. Add DATABASE_URL_2 and
                    DIRECT_URL_2 on Vercel for DB2.
                </p>
                {keyList}
            </section>
        );
    }

    async function doSwitch() {
        if (!status || typed !== "SWITCH") return;
        const ok = await confirmAction({
            title: `Make ${status.staging} the primary?`,
            body: `Every user, counter and service moves from ${status.primary} to ${status.staging} within a minute. ${status.primary} becomes staging, is locked read-only, and gets tonight's copy. Counters left open overnight must be restarted.`,
            confirmLabel: `Switch to ${status.staging}`,
        });
        if (!ok) return;
        setSwitching(true);
        try {
            const res = await fetch("/api/settings/db-switch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirm: "SWITCH" }),
            });
            const json = (await res.json().catch(() => null)) as { error?: string; primary?: string; status?: Status } | null;
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            toast.success(`${json?.primary} is now the primary.`);
            if (json?.status) setStatus(json.status);
            setTyped("");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Switch failed");
        } finally {
            setSwitching(false);
        }
    }

    const { copy, window: win } = status;
    const copyFailed = !!copy.failedAt && (!copy.copiedAt || copy.failedAt > copy.copiedAt);

    return (
        <section className="space-y-4 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                        <Database className="size-4" /> Databases
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Everyone works on the primary. Staging gets a full copy every night and stays read-only.
                    </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
                    <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
                </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
                {status.dbs.map((db) => (
                    <div key={db.id} className="rounded-md border bg-background p-3">
                        <div className="flex items-center justify-between">
                            <span className="font-mono text-sm font-semibold">{db.id}</span>
                            <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                                    db.role === "primary" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                }`}
                            >
                                {db.role}
                            </span>
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">{db.projectRef || "—"}</p>
                        <p className={`text-[11px] ${db.reachable ? "text-muted-foreground" : "text-destructive"}`}>
                            {db.reachable ? (db.readOnly ? "Answering · read-only" : "Answering · writable") : "Not answering"}
                        </p>
                    </div>
                ))}
            </div>

            {keyList}

            <div className="space-y-0.5 text-xs">
                <p>
                    Last copy into staging: <span className="font-medium">{when(copy.copiedAt)}</span>
                    {copy.into ? <span className="text-muted-foreground"> (into {copy.into})</span> : null}
                </p>
                {copyFailed && <p className="text-destructive">Copy failed at {when(copy.failedAt)}.</p>}
            </div>

            <div className="space-y-2 border-t pt-3">
                <p className={`text-xs ${win.open ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {win.open ? `Switching is open until ${when(win.until)}.` : win.reason}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        value={typed}
                        onChange={(e) => setTyped(e.target.value.toUpperCase())}
                        placeholder="SWITCH"
                        className="h-8 w-32 font-mono text-xs"
                        disabled={!win.open}
                    />
                    <Button size="sm" onClick={() => void doSwitch()} disabled={!win.open || typed !== "SWITCH" || switching}>
                        <ArrowLeftRight className="mr-1.5 size-3.5" />
                        {switching ? "Switching…" : `Make ${status.staging} primary`}
                    </Button>
                </div>
            </div>
        </section>
    );
}
