"use client";

/**
 * Counter onboarding — shown after staff login on any Electron install with no local
 * `counter-setup.json` (see staff/login/page.tsx, which redirects here instead of `dest`).
 *
 * ── The order, and why ──────────────────────────────────────────────────────
 *   1. Pick a counter (list and device locks read from the DB — online only).
 *   2. Claim: bind this PC in the DB, apply the counter's id range locally.
 *   3. Start the sync worker and WAIT for the replica to fill.
 *   4. Only then write `counter-setup.json` and open the app.
 *
 * The DB binding is the truth; the file is a local shortcut written last. So a
 * half-done onboarding (killed during the fill, file never written) leaves a bound
 * counter and a PC with no file: the next boot cleans the replica, comes back here, and
 * this screen finds the row already bound to this PC — that row is then the ONLY one it
 * offers, until an admin releases it. No other PC sees that counter as free meanwhile.
 *
 * Not skippable: no back door, no "later" option. There is a Sign out, because an
 * offline wizard with a live session behind it would otherwise be a dead end.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";
import { resolveMachineIdentity, type MachineIdentity } from "@/shared/lib/counter/identity";
import { replicaProgressStep, replicaIsFilled } from "@/shared/lib/sync";

interface CounterOption {
    id: number;
    name: string;
    branch: { name: string } | null;
    counterNumber: number;
    boundDeviceId: string | null;
    boundDeviceLabel: string | null;
}

interface SyncStatusBody {
    replica: {
        ready: boolean;
        lastCycleAt: string | null;
        failing: string[];
        neverSynced: string[];
        tablesSynced: number;
        tablesTotal: number;
    } | null;
}

const FILL_POLL_MS = 3_000;

function isThisPc(c: CounterOption, identity: MachineIdentity | null): boolean {
    return Boolean(c.boundDeviceId && identity
        && (c.boundDeviceId === identity.machineId || c.boundDeviceId === identity.legacyDeviceId));
}

function CounterSetupForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const next = searchParams.get("next") || "/office/work-flow-inbox";

    const [counters, setCounters] = useState<CounterOption[] | null>(null);
    const [identity, setIdentity] = useState<MachineIdentity | null>(null);
    const [selectedId, setSelectedId] = useState<string>("");
    const [loadError, setLoadError] = useState("");
    // Whether the DB could be reached to check the device locks. False means the list
    // is shown but nothing may be claimed.
    const [locksReachable, setLocksReachable] = useState(true);
    const [phase, setPhase] = useState<"pick" | "claiming" | "filling">("pick");
    const [progress, setProgress] = useState("Starting the first sync…");

    useEffect(() => {
        // Not an Electron install — this screen has nothing to do. Send them on.
        if (!isElectronEnvironment()) {
            router.replace(next);
            return;
        }

        // `authoritative=1` — the device-lock fields come from the DB, not from this
        // machine's replica (which is empty here anyway: a PC with no counter holds no
        // data). Two PCs must never bind one counter, so this read is never local.
        Promise.all([
            resolveMachineIdentity(),
            axios.get<{ counters: CounterOption[]; locksReachable: boolean }>("/api/pos/counters?scope=all&authoritative=1"),
        ])
            .then(([id, res]) => {
                setIdentity(id);
                setCounters(res.data.counters);
                setLocksReachable(res.data.locksReachable);
                // Resumed onboarding: the DB already binds a row to this PC. Pre-select
                // it; the dropdown below offers nothing else.
                const mine = res.data.counters.find((c) => isThisPc(c, id));
                if (mine) setSelectedId(String(mine.id));
            })
            .catch(() => setLoadError("Could not load the counter list. Check the connection and reload."));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const mine = counters?.find((c) => isThisPc(c, identity)) ?? null;
    const selected = counters?.find((c) => String(c.id) === selectedId) ?? null;

    /** Which rows this PC may pick: its own bound row if it has one, else the free ones. */
    const selectable = (c: CounterOption): boolean =>
        mine ? c.id === mine.id : !c.boundDeviceId;

    const submit = async () => {
        if (!selected) { toast.error("Select which counter this PC is"); return; }
        if (!locksReachable) {
            toast.error("Cannot check which counters are free while the cloud is unreachable. Connect and try again.");
            return;
        }
        if (!selectable(selected)) return;
        await claim(selected);
    };

    /** Binds this PC in the DB, fills the replica, then writes the local file. */
    const claim = async (target: CounterOption) => {
        setPhase("claiming");
        try {
            const deviceId = identity?.machineId ?? identity?.legacyDeviceId;
            if (!deviceId) {
                toast.error("Could not identify this PC. Restart the app and try again.");
                setPhase("pick");
                return;
            }

            // 1. Bind in the DB (no-op when the row already says this PC) and get the
            //    counter's id-range block back.
            const { data } = await axios.post<{ idRangeStart: number | null }>(
                `/api/pos/counters/${target.id}/claim-number`,
                {
                    deviceId,
                    ...(identity?.legacyDeviceId && identity.legacyDeviceId !== deviceId
                        ? { legacyDeviceId: identity.legacyDeviceId }
                        : {}),
                    deviceLabel: identity?.deviceLabel,
                },
            );

            if (data.idRangeStart !== null && window.electronAPI?.applyIdRanges) {
                const applied = await window.electronAPI.applyIdRanges(data.idRangeStart).catch(() => false);
                if (!applied) {
                    toast.warning("Could not confirm the offline id range applied yet — it will retry on the next shift open.");
                }
            }

            // 2. Fill the replica. The worker is normally gated on the setup file at
            //    boot; the wizard starts it explicitly because the file is written LAST.
            const started = await window.electronAPI?.startSync?.().catch(() => false);
            if (!started) {
                toast.error("Could not start the local sync. Restart the app and sign in again — this counter stays reserved for this PC.");
                setPhase("pick");
                return;
            }
            setPhase("filling");
            await waitForReplicaFill(setProgress);

            // 3. Only now is this PC a counter.
            await window.electronAPI?.saveCounterSetup?.({ counterId: target.id, counterNumber: target.counterNumber });
            toast.success(`This PC is now set as "${target.name}"`);
            router.replace(next);
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e)
                ? (e.response?.data as { error?: string })?.error ?? "Failed to set up this counter"
                : "Failed to set up this counter";
            toast.error(msg);
            setPhase("pick");
        }
    };

    const busy = phase !== "pick";

    return (
        <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Counter Setup</CardTitle>
                    <CardDescription>
                        {mine
                            ? `This PC is already reserved as "${mine.name}". Continue to finish setting it up.`
                            : "This PC hasn't been set up yet. Pick which counter it is — this only needs to happen once per machine."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {loadError && <p className="text-sm text-destructive">{loadError}</p>}

                    {!locksReachable && !loadError && (
                        <p className="text-sm text-destructive">
                            Cannot reach the cloud to check which counters are already taken.
                            Setting up on a guess could put two PCs on one counter, so this
                            screen will not claim one until the connection is back. A counter
                            can only be set up online; once set up, this PC signs in offline too.
                        </p>
                    )}

                    <div className="space-y-2">
                        <Label>Counter</Label>
                        <Select value={selectedId} onValueChange={setSelectedId} disabled={!counters || !locksReachable || busy}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder={counters ? "Select a counter…" : "Loading…"} />
                            </SelectTrigger>
                            <SelectContent>
                                {counters?.map((c) => {
                                    const here = isThisPc(c, identity);
                                    const label = here
                                        ? " — reserved for this PC"
                                        : c.boundDeviceId
                                            ? ` — in use by ${c.boundDeviceLabel || "another PC"}`
                                            : mine
                                                ? ` — release "${mine.name}" from this PC first`
                                                : " — free";
                                    return (
                                        <SelectItem key={c.id} value={String(c.id)} disabled={!selectable(c)}>
                                            {c.name}{c.branch ? ` — ${c.branch.name}` : ""}{label}
                                        </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>
                    </div>

                    {selected && phase === "pick" && (
                        <p className="text-xs text-muted-foreground">
                            Counter number {selected.counterNumber} — this PC will be locked to it, its data
                            will be copied here, and its offline sales will never collide with another counter&apos;s.
                        </p>
                    )}

                    {phase === "filling" && (
                        <div className="space-y-1 rounded-md border bg-muted/40 p-3" aria-live="polite">
                            <p className="text-sm font-medium">Preparing this counter</p>
                            <p className="font-mono text-xs text-foreground/80">{progress}</p>
                            <p className="text-xs text-muted-foreground">
                                Copying the shop&apos;s data to this PC. Usually a few minutes. Keep the app
                                open — if it is closed, setup resumes from here next time.
                            </p>
                        </div>
                    )}

                    <Button
                        className="w-full"
                        disabled={!selected || !selectable(selected) || busy || !locksReachable}
                        onClick={submit}
                    >
                        {phase === "claiming" ? "Reserving…" : phase === "filling" ? "Copying data…" : "Save and Continue"}
                    </Button>
                    {/* A live session behind a screen that cannot proceed is a dead end —
                        offline, or the wrong person signed in. Let them out. */}
                    <Button
                        variant="ghost"
                        className="w-full"
                        disabled={busy}
                        onClick={() => signOut({ callbackUrl: "/staff/login" })}
                    >
                        Sign out
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

/**
 * Resolves once the replica reports a completed first cycle with `ready = true`. Polls
 * the local-only status route; nothing here touches Supabase. Never rejects — a status
 * request that fails is simply "not yet".
 */
async function waitForReplicaFill(onProgress: (line: string) => void): Promise<void> {
    for (;;) {
        try {
            const { data } = await axios.get<SyncStatusBody>("/api/sync/status", { headers: { "cache-control": "no-store" } });
            if (replicaIsFilled(data.replica)) return;
            onProgress(replicaProgressStep(data.replica));
        } catch {
            onProgress("Checking the local copy…");
        }
        await new Promise((r) => setTimeout(r, FILL_POLL_MS));
    }
}

export default function CounterSetupPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4 text-muted-foreground text-sm">
                    Loading…
                </div>
            }
        >
            <CounterSetupForm />
        </Suspense>
    );
}
