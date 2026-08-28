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

        axios.get<CounterOption[]>("/api/pos/counters?scope=all")
            .then((res) => setCounters(res.data))
            .catch(() => setLoadError("Could not load the counter list. Check the connection and reload."));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const selected = counters?.find((c) => String(c.id) === selectedId) ?? null;
    const isSelectedLockedToOther = Boolean(
        selected?.boundDeviceId && currentDeviceId && selected.boundDeviceId !== currentDeviceId
    );

    const submit = async () => {
        if (!selected) { toast.error("Select which counter this PC is"); return; }
        if (isSelectedLockedToOther) {
            toast.error("This counter is already locked to another PC. An admin must release it in Counter Settings.");
            return;
        }

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

                    <div className="space-y-2">
                        <Label>Counter</Label>
                        <Select value={selectedId} onValueChange={setSelectedId} disabled={!counters}>
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
                                                ? ` (Locked: ${c.boundDeviceLabel || "Another PC"})`
                                                : isBoundHere
                                                    ? " (This PC)"
                                                    : " (Available)"}
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
                        disabled={!selected || isSelectedLockedToOther || submitting}
                        onClick={submit}
                    >
                        {submitting ? "Saving…" : "Save and Continue"}
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
