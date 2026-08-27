"use client";

/**
 * First-launch counter setup — shown once per machine, after staff login and
 * before the POS screen, on any Electron install with no local `counter.json`
 * (see staff/login/page.tsx, which redirects here instead of `dest`).
 *
 * Picks which PosCounter this PC is, and — if that counter has no counterNumber
 * yet — claims one (1–99). Immediately applies the resulting id-range to the
 * local replica's sequences before ever letting the counter bill anything, so
 * "set up" and "safe to write offline" become the same moment rather than two.
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";
import { MAX_COUNTER_NUMBER } from "@/shared/lib/counter/idRange";

interface CounterOption {
    id: number;
    name: string;
    branch: { name: string } | null;
    counterNumber: number | null;
    epbxExtension: string | null;
}

/** Clean 1–99 number, or null if this extension can't be used as one. */
function extensionAsCounterNumber(ext: string | null): number | null {
    const n = Number(ext);
    return Number.isInteger(n) && n >= 1 && n <= MAX_COUNTER_NUMBER ? n : null;
}

function CounterSetupForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const next = searchParams.get("next") || "/office/work-flow-inbox";

    const [counters, setCounters] = useState<CounterOption[] | null>(null);
    const [selectedId, setSelectedId] = useState<string>("");
    const [numberInput, setNumberInput] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [loadError, setLoadError] = useState("");

    useEffect(() => {
        // Not an Electron install — this screen has nothing to do. Send them on.
        if (!isElectronEnvironment()) {
            router.replace(next);
            return;
        }
        axios.get<CounterOption[]>("/api/pos/counters?scope=all")
            .then((res) => setCounters(res.data))
            .catch(() => setLoadError("Could not load the counter list. Check the connection and reload."));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const selected = counters?.find((c) => String(c.id) === selectedId) ?? null;
    const autoNumber = selected ? extensionAsCounterNumber(selected.epbxExtension) : null;
    // Only ask for a number by hand when the counter has none yet AND its
    // epbxExtension isn't already a clean 1–99 number to derive one from.
    const needsNumber = selected && selected.counterNumber === null && autoNumber === null;

    const submit = async () => {
        if (!selected) { toast.error("Select which counter this PC is"); return; }

        let counterNumber = selected.counterNumber ?? autoNumber;
        if (needsNumber) {
            const parsed = Number(numberInput);
            if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_COUNTER_NUMBER) {
                toast.error(`Enter a whole number from 1 to ${MAX_COUNTER_NUMBER}`);
                return;
            }
            counterNumber = parsed;
        }
        if (counterNumber === null) return; // unreachable, satisfies TS

        const stillUnclaimed = selected.counterNumber === null;
        setSubmitting(true);
        try {
            let idRangeStart: number | null = null;
            if (stillUnclaimed) {
                const { data } = await axios.post<{ idRangeStart: number }>(
                    `/api/pos/counters/${selected.id}/claim-number`,
                    needsNumber ? { counterNumber } : {},
                );
                idRangeStart = data.idRangeStart;
            }

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
                                {counters?.map((c) => (
                                    <SelectItem key={c.id} value={String(c.id)}>
                                        {c.name}{c.branch ? ` — ${c.branch.name}` : ""}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {needsNumber && (
                        <div className="space-y-2">
                            <Label>Counter Number (1–{MAX_COUNTER_NUMBER})</Label>
                            <Input
                                type="number"
                                min={1}
                                max={MAX_COUNTER_NUMBER}
                                value={numberInput}
                                onChange={(e) => setNumberInput(e.target.value)}
                                placeholder="e.g. 3"
                            />
                            <p className="text-xs text-muted-foreground">
                                This counter hasn&apos;t been assigned a number yet — needed once, so
                                offline sales here never collide with another counter&apos;s.
                            </p>
                        </div>
                    )}

                    <Button className="w-full" disabled={!selected || submitting} onClick={submit}>
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
