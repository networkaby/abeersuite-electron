"use client";

/**
 * First-launch counter setup — shown once per machine, after staff login and
 * before the POS screen, on any Electron install with no local `counter.json`
 * (see staff/login/page.tsx, which redirects here instead of `dest`).
 *
 * Picks which PosCounter this PC is, binds the device lock to this machine, and
 * immediately applies that counter's id-range to the local replica's sequences
 * before ever letting it bill anything — so "set up", "this PC owns the counter"
 * and "safe to write offline" all become the same moment rather than three.
 *
 * There is no counter-number step: counterNumber is permanent config, required
 * when the counter is created in /office/admin/counters.
 *
 * Not skippable: no back door, no "later" option. A counter with no identity
 * cannot bill anything needing a counter-prefixed reference or write offline —
 * see the guards in api/pos/sale/route.ts and prismaClient.ts's createLocal().
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
import { resolveMachineIdentity } from "@/shared/lib/counter/identity";

interface CounterOption {
    id: number;
    name: string;
    branch: { name: string } | null;
    counterNumber: number;
    boundDeviceId: string | null;
    boundDeviceLabel: string | null;
}

function CounterSetupForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const next = searchParams.get("next") || "/office/work-flow-inbox";

    const [counters, setCounters] = useState<CounterOption[] | null>(null);
    const [selectedId, setSelectedId] = useState<string>("");
    const [submitting, setSubmitting] = useState(false);
    const [loadError, setLoadError] = useState("");
    // Whether the DB could be reached to check the device locks. False means the list
    // is shown but nothing may be claimed — see the fetch below.
    const [locksReachable, setLocksReachable] = useState(true);
    const [currentDeviceId, setCurrentDeviceId] = useState<string>("");

    useEffect(() => {
        // Not an Electron install — this screen has nothing to do. Send them on.
        if (!isElectronEnvironment()) {
            router.replace(next);
            return;
        }

        resolveMachineIdentity().then((identity) => {
            const devId = identity.machineId ?? identity.legacyDeviceId ?? "";
            setCurrentDeviceId(devId);
        });

        // `authoritative=1` — the device-lock fields come from the DB, not from this
        // machine's replica. The replica's copy is the one THIS PC writes at shift
        // open, so trusting it here greys out counters an admin has already released
        // (and this machine's own binding from before a reinstall changed its
        // installation id), while a counter another PC genuinely holds could look free.
        axios.get<{ counters: CounterOption[]; locksReachable: boolean }>(
            "/api/pos/counters?scope=all&authoritative=1")
            .then((res) => {
                setCounters(res.data.counters);
                setLocksReachable(res.data.locksReachable);
                // The DB already binds a counter to this PC — the local file went (a
                // reset, a reinstall) but the binding did not. There is nothing to ask:
                // this PC IS that counter. Restore the file and go straight in. Only
                // when the DB was actually consulted, though — a stale list must not
                // re-bind a counter an admin has since moved.
                if (!res.data.locksReachable) return;
                resolveMachineIdentity().then((identity) => {
                    const mine = res.data.counters.find((c) =>
                        c.boundDeviceId && [identity.machineId, identity.legacyDeviceId].includes(c.boundDeviceId));
                    if (!mine) return;
                    setSelectedId(String(mine.id));
                    toast.info(`This PC is already "${mine.name}" — restoring its setup.`);
                    void claim(mine);
                });
            })
            .catch(() => setLoadError("Could not load the counter list. Check the connection and reload."));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const selected = counters?.find((c) => String(c.id) === selectedId) ?? null;
    const isSelectedLockedToOther = Boolean(
        selected?.boundDeviceId && currentDeviceId && selected.boundDeviceId !== currentDeviceId
    );

    const submit = async () => {
        if (!selected) { toast.error("Select which counter this PC is"); return; }
        if (!locksReachable) {
            toast.error("Cannot check which counters are free while the cloud is unreachable. Connect and try again.");
            return;
        }
        if (isSelectedLockedToOther) {
            toast.error("This counter is already locked to another PC. An admin must release it in Counter Settings.");
            return;
        }
        await claim(selected);
    };

    /** Binds this PC to `target` and writes the local setup file. */
    const claim = async (target: CounterOption) => {
        const selected = target;
        const counterNumber = selected.counterNumber;
        setSubmitting(true);
        try {
            // Bind the device lock to this PC and get back the counter's id-range block.
            const identity = await resolveMachineIdentity();
            const deviceId = identity.machineId ?? identity.legacyDeviceId;
            if (!deviceId) {
                toast.error("Could not identify this PC. Restart the app and try again.");
                return;
            }

            const { data } = await axios.post<{ idRangeStart: number | null }>(
                `/api/pos/counters/${selected.id}/claim-number`,
                {
                    deviceId,
                    ...(identity.legacyDeviceId && identity.legacyDeviceId !== deviceId
                        ? { legacyDeviceId: identity.legacyDeviceId }
                        : {}),
                    deviceLabel: identity.deviceLabel,
                },
            );
            const idRangeStart = data.idRangeStart;

            if (idRangeStart !== null && typeof window !== "undefined" && window.electronAPI?.applyIdRanges) {
                const applied = await window.electronAPI.applyIdRanges(idRangeStart).catch(() => false);
                if (!applied) {
                    toast.warning("Counter saved, but could not confirm the offline id range applied yet — it will retry on the next shift open.");
                }
            }

            if (typeof window !== "undefined" && window.electronAPI?.saveCounterSetup) {
                await window.electronAPI.saveCounterSetup({ counterId: selected.id, counterNumber });
            }

            toast.success(`This PC is now set as "${selected.name}"`);
            router.replace(next);
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e)
                ? (e.response?.data as { error?: string })?.error ?? "Failed to save counter setup"
                : "Failed to save counter setup";
            toast.error(msg);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Counter Setup</CardTitle>
                    <CardDescription>
                        This PC hasn&apos;t been set up yet. Pick which counter it is — this only
                        needs to happen once per machine.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {loadError && <p className="text-sm text-destructive">{loadError}</p>}

                    {!locksReachable && !loadError && (
                        <p className="text-sm text-destructive">
                            Cannot reach the cloud to check which counters are already taken.
                            Setting up on a guess could put two PCs on one counter, so this
                            screen will not claim one until the connection is back. A counter
                            can only be bound online; once bound, this PC signs in offline too.
                        </p>
                    )}

                    <div className="space-y-2">
                        <Label>Counter</Label>
                        <Select value={selectedId} onValueChange={setSelectedId} disabled={!counters || !locksReachable}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder={counters ? "Select a counter…" : "Loading…"} />
                            </SelectTrigger>
                            <SelectContent>
                                {counters?.map((c) => {
                                    const isLockedElsewhere = Boolean(
                                        c.boundDeviceId && currentDeviceId && c.boundDeviceId !== currentDeviceId
                                    );
                                    const isBoundHere = Boolean(
                                        c.boundDeviceId && currentDeviceId && c.boundDeviceId === currentDeviceId
                                    );
                                    return (
                                        <SelectItem
                                            key={c.id}
                                            value={String(c.id)}
                                            disabled={isLockedElsewhere}
                                        >
                                            {c.name}{c.branch ? ` — ${c.branch.name}` : ""}
                                            {isLockedElsewhere
                                                ? ` — in use by ${c.boundDeviceLabel || "another PC"}`
                                                : isBoundHere
                                                    ? " — already this PC"
                                                    : " — free"}
                                        </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>
                    </div>

                    {selected && (
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">
                                Counter number {selected.counterNumber} — this PC will be locked to it,
                                and its offline sales will never collide with another counter&apos;s.
                            </p>
                            {isSelectedLockedToOther && (
                                <p className="text-xs font-medium text-destructive">
                                    ⚠️ This counter is currently locked to {selected.boundDeviceLabel || "another device"}.
                                    Please choose an available counter or have an admin release it in Counter Settings.
                                </p>
                            )}
                        </div>
                    )}

                    <Button
                        className="w-full"
                        disabled={!selected || isSelectedLockedToOther || submitting || !locksReachable}
                        onClick={submit}
                    >
                        {submitting ? "Saving…" : "Save and Continue"}
                    </Button>
                    {/* A live session behind a screen that cannot proceed is a dead end —
                        offline, or the wrong person signed in. Let them out. */}
                    <Button
                        variant="ghost"
                        className="w-full"
                        disabled={submitting}
                        onClick={() => signOut({ callbackUrl: "/staff/login" })}
                    >
                        Sign out
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
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
