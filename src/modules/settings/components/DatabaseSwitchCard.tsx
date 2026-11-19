"use client";

/**
 * Settings → Backup & Restore → Databases: DB1 / DB2, which is primary (NEXT_PUBLIC_DB_PRIMARY),
 * the nightly copy into the standby, and "Lock for switch" (step 1 of a switch; step 2 is
 * the Vercel setting and a redeploy).
 *
 * Hidden on a counter or without settings:manage. With one database it still shows, so
 * the owner can see which of DATABASE_URL_1/_2, DIRECT_URL_1/_2 this deployment has.
 * The button state is a convenience; the server checks the copy and compares both
 * databases again before it locks anything.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Database, RefreshCw, ArrowLeftRight, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { realtimeProject } from "@/shared/lib/supabase/supabaseClient";

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
    locked: boolean;
    lockBlocked: string | null;
    copyBlocked: string | null;
    checklist: EnvRow[];
}
/** Mirrors EnvRow in shared/lib/db/envChecklist.server.ts. */
interface EnvRow {
    group: "DB1" | "DB2" | "Vercel cron" | "GitHub" | "Dropbox";
    key: string;
    what: string;
    neededFor: string;
    where: "Vercel" | "GitHub";
    set: boolean | null;
    note: string;
    light: "green" | "amber" | "red" | "grey";
}

/** Rows by group, in the order the server sent them. */
function byGroup(rows: EnvRow[]): [EnvRow["group"], EnvRow[]][] {
    const out = new Map<EnvRow["group"], EnvRow[]>();
    for (const r of rows) out.set(r.group, [...(out.get(r.group) ?? []), r]);
    return [...out];
}

const groupLight = (rows: EnvRow[]): EnvRow["light"] =>
    rows.some((r) => r.light === "red") ? "red" : rows.some((r) => r.light === "amber") ? "amber" : rows.every((r) => r.light === "grey") ? "grey" : "green";

const LIGHT: Record<EnvRow["light"], string> = {
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    grey: "bg-muted-foreground/30",
};

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
        <details className="rounded-md border bg-background" open={status.checklist.some((r) => r.light === "red")}>
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
                Settings needed on Vercel and GitHub
                <span className="ml-2 text-muted-foreground">
                    {status.checklist.filter((r) => r.light === "red").length} missing ·{" "}
                    {status.checklist.filter((r) => r.light === "amber").length} to check
                </span>
            </summary>
            <div className="overflow-x-auto border-t">
                <table className="w-full text-[11px]">
                    <thead className="text-left text-muted-foreground">
                        <tr>
                            <th className="px-3 py-1.5 font-medium" />
                            <th className="px-2 py-1.5 font-medium">Name</th>
                            <th className="px-2 py-1.5 font-medium">What</th>
                            <th className="px-2 py-1.5 font-medium">Needed for</th>
                            <th className="px-2 py-1.5 font-medium">Where</th>
                            <th className="px-2 py-1.5 font-medium">Status</th>
                        </tr>
                    </thead>
                    {byGroup(status.checklist).map(([group, rows]) => (
                        <tbody key={group}>
                            <tr className="border-t bg-muted/40">
                                <td className="px-3 py-1.5">
                                    <span className={`inline-block size-2.5 rounded-full ${LIGHT[groupLight(rows)]}`} />
                                </td>
                                <td colSpan={5} className="px-2 py-1.5 font-semibold">
                                    {group}
                                </td>
                            </tr>
                            {rows.map((r) => (
                                <tr key={`${r.where}:${r.key}`} className="border-t">
                                    <td className="px-3 py-1.5 pl-6">
                                        <span className={`inline-block size-2 rounded-full ${LIGHT[r.light]}`} />
                                    </td>
                                    <td className="px-2 py-1.5 font-mono">{r.key}</td>
                                    <td className="px-2 py-1.5">{r.what}</td>
                                    <td className="px-2 py-1.5 text-muted-foreground">{r.neededFor}</td>
                                    <td className="px-2 py-1.5">{r.where}</td>
                                    <td className="px-2 py-1.5">{r.note}</td>
                                </tr>
                            ))}
                        </tbody>
                    ))}
                </table>
            </div>
        </details>
    );

    if (!status.dual) {
        return (
            <section className="space-y-2 rounded-lg border bg-card p-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Database className="size-4" /> Databases
                </h2>
                <p className="text-xs text-muted-foreground">
                    Only one database is set up, so there is no standby copy and no switch. Add DATABASE_URL_2 and
                    DIRECT_URL_2 on Vercel for DB2.
                </p>
                {keyList}
            </section>
        );
    }

    async function post(action: "lock" | "unlock" | "copy") {
        if (!status) return;
        if (action === "copy") {
            const ok = await confirmAction({
                title: `Copy ${status.primary} into ${status.staging} now?`,
                body: `Everything in ${status.staging} is replaced with a fresh copy of ${status.primary} (also saved to Dropbox). ${status.primary} keeps working. Takes about 10 minutes; press refresh afterwards.`,
                confirmLabel: "Start copy",
            });
            if (!ok) return;
        }
        if (action === "lock") {
            if (typed !== "LOCK") return;
            const ok = await confirmAction({
                title: `Lock ${status.primary} for a switch?`,
                body: `${status.primary} becomes read-only now: every save, sale and counter write fails until you change NEXT_PUBLIC_DB_PRIMARY to ${status.staging} on Vercel (office AND shop) and the redeploy finishes, about 3–5 minutes. Do this when nobody is billing.`,
                confirmLabel: `Lock ${status.primary}`,
            });
            if (!ok) return;
        }
        setSwitching(true);
        try {
            const res = await fetch("/api/settings/db-switch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(action === "lock" ? { action, confirm: "LOCK" } : { action }),
            });
            const json = (await res.json().catch(() => null)) as { error?: string; status?: Status } | null;
            if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            toast.success(
                action === "lock"
                    ? `${status.primary} is locked. Now change the Vercel setting and redeploy.`
                    : action === "copy"
                      ? `Copy into ${status.staging} started. About 10 minutes; press refresh to see it finish.`
                      : `${status.primary} is writable again.`,
            );
            if (json?.status) setStatus(json.status);
            setTyped("");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed");
        } finally {
            setSwitching(false);
        }
    }

    const { copy } = status;
    const copyFailed = !!copy.failedAt && (!copy.copiedAt || copy.failedAt > copy.copiedAt);

    return (
        <section className="space-y-4 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                        <Database className="size-4" /> Databases
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Everyone works on the primary. The standby gets a full copy every night and stays read-only.
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
                                {db.role === "primary" ? "Primary" : "Standby"}
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
                    Last copy into standby: <span className="font-medium">{when(copy.copiedAt)}</span>
                    {copy.into ? <span className="text-muted-foreground"> (into {copy.into})</span> : null}
                </p>
                {copyFailed && <p className="text-destructive">Copy failed at {when(copy.failedAt)}.</p>}
                {status.copyBlocked && <p className="text-amber-600">{status.copyBlocked}</p>}
                <div className="pt-1">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void post("copy")}
                        disabled={!!status.copyBlocked || switching}
                    >
                        <Copy className="mr-1.5 size-3.5" />
                        Copy into {status.staging} now
                    </Button>
                </div>
                <p className="text-muted-foreground">Live updates on this page use {realtimeProject()}&apos;s realtime project.</p>
            </div>

            <div className="space-y-2 border-t pt-3 text-xs">
                <p className="font-medium">Switch to {status.staging}</p>
                {status.locked ? (
                    <>
                        <p className="text-amber-600">
                            {status.primary} is locked (read-only). Saves fail until the switch finishes. On Vercel, set{" "}
                            <span className="font-mono">NEXT_PUBLIC_DB_PRIMARY={status.staging}</span> on the office AND shop
                            projects and redeploy both.
                        </p>
                        <Button size="sm" variant="outline" onClick={() => void post("unlock")} disabled={switching}>
                            Cancel: unlock {status.primary}
                        </Button>
                    </>
                ) : (
                    <>
                        <p className="text-muted-foreground">
                            1. Lock {status.primary} here (checks the last copy and that both databases match). 2. Set{" "}
                            <span className="font-mono">NEXT_PUBLIC_DB_PRIMARY={status.staging}</span> on Vercel (office and shop)
                            and redeploy. If {status.primary} is dead, skip step 1.
                        </p>
                        {status.lockBlocked && <p className="text-muted-foreground">{status.lockBlocked}</p>}
                        <div className="flex flex-wrap items-center gap-2">
                            <Input
                                value={typed}
                                onChange={(e) => setTyped(e.target.value.toUpperCase())}
                                placeholder="LOCK"
                                className="h-8 w-32 font-mono text-xs"
                                disabled={!!status.lockBlocked}
                            />
                            <Button size="sm" onClick={() => void post("lock")} disabled={!!status.lockBlocked || typed !== "LOCK" || switching}>
                                <ArrowLeftRight className="mr-1.5 size-3.5" />
                                {switching ? "Locking…" : `Lock ${status.primary} for switch`}
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </section>
    );
}
