"use client";

// ── ShiftOpenDialog ──────────────────────────────────────────────────────────
// Shown by PosScreen when the cashier has no active shift at this branch.
// Cashier picks a counter, sees the carry-over balance already sitting in it,
// optionally adds a vault top-up, then opens the shift.
//
// Opening Contra (Vault → Counter till) is posted ONLY for the top-up portion.
// If the counter already has a carry-over float the cashier just starts billing.
//
// A counter with somebody else's shift on it is not opened on top: picking it
// offers "Review & take over" instead (ShiftTakeoverDialog), when the screen
// hosting this dialog supports the takeover.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Monitor, Banknote } from "lucide-react";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/shared/components/NumericInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmt } from "@/shared/lib/format/moneyInr";
import { extractApiError } from "@/shared/lib/api";
import { openCashDrawer } from "@/shared/lib/print/silentThermalPrint";
import { resolveMachineIdentity, matchesThisMachine } from "@/shared/lib/counter/identity";
import { applyCounterIdRanges } from "@/modules/pos/lib/counterIdRanges";

type Counter = {
    id: number;
    name: string;
    tillAccount: { id: number; name: string; balance: string };
    activeShift: { id: number; status: string; user: { name: string } } | null;
    // Device lock — the PC (bridge deviceId) this counter is bound to. Null = free.
    boundDeviceId: string | null;
};

export type OpenedShift = {
    id: number;
    resumed?: boolean;   // true when an existing shift was recovered (browser crash/reopen)
    idRangeStart?: number | null;
    counter: { id: number; name: string; tillAccount: { id: number; name: string } };
    branch:  { id: string; name: string };
    openingFloatPaise:   string;
    carryOverFloatPaise: string;
    vaultTopUpPaise:     string;
};

export function ShiftOpenDialog({
    open, onOpenChange, onOpened, onTakeover,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpened: (shift: OpenedShift) => void;
    // Review and take over the drawer on a busy counter. Absent → busy counters
    // stay unpickable here.
    onTakeover?: (counterId: number) => void;
}) {
    const [counters, setCounters]         = useState<Counter[]>([]);
    const [loadingCounters, setLoadingCounters] = useState(false);
    const [selectedCounterId, setSelectedCounterId] = useState<number | null>(null);
    // This PC's identity — Electron's installation id on the desktop app, the local
    // bridge's id on the web version. The counter this device is bound to server-side
    // forces + disables the picker.
    const [deviceId, setDeviceId]         = useState<string | null>(null);
    const [deviceLabel, setDeviceLabel]   = useState<string | null>(null);
    const [vaultTopUp, setVaultTopUp]     = useState("0");            // rupees
    const [notes, setNotes]               = useState("");
    const [submitting, setSubmitting]     = useState(false);

    // Fetch counters each time the dialog opens.
    useEffect(() => {
        if (!open) return;
        setLoadingCounters(true);
        axios.get<Counter[]>("/api/pos/counters")
            .then((r) => {
                setCounters(r.data);
                // Auto-select if only one available counter.
                const available = r.data.filter((c) => !c.activeShift);
                if (available.length === 1) setSelectedCounterId(available[0].id);
            })
            .catch(() => toast.error("Failed to load counters"))
            .finally(() => setLoadingCounters(false));

        // This PC's identity. The server checks the counter's device lock against it;
        // binding itself happens in counter onboarding, not here. Best-effort — if
        // neither Electron nor the bridge answers, no device lock this session.
        resolveMachineIdentity().then(({ machineId, deviceLabel: label }) => {
            setDeviceId(machineId);
            setDeviceLabel(label);
        });
    }, [open]);

    // The counter this PC is bound to (server-side). When set, the picker is
    // forced to it and locked.
    const lockedCounter = deviceId
        ? counters.find((c) => matchesThisMachine(c.boundDeviceId, { machineId: deviceId })) ?? null
        : null;
    useEffect(() => {
        if (lockedCounter) setSelectedCounterId(lockedCounter.id);
    }, [lockedCounter]);

    const selectedCounter = counters.find((c) => c.id === selectedCounterId) ?? null;
    // Somebody else's drawer is on the picked counter — it is taken over, not opened.
    const busyCounter = selectedCounter?.activeShift ? selectedCounter : null;
    const carryOverRupees = selectedCounter ? Number(selectedCounter.tillAccount.balance) : 0;
    const topUpRupees     = parseFloat(vaultTopUp) || 0;
    const totalFloat      = carryOverRupees + topUpRupees;

    const submit = async () => {
        if (!selectedCounterId) { toast.error("Select a counter first"); return; }
        if (topUpRupees < 0) { toast.error("Top-up cannot be negative"); return; }
        setSubmitting(true);
        try {
            const { data } = await axios.post<OpenedShift>("/api/pos/shifts", {
                counterId:       selectedCounterId,
                vaultTopUpPaise: Math.round(topUpRupees * 100),
                notes:           notes.trim() || undefined,
                // For the device-lock check only — the server never binds here.
                deviceId:        deviceId ?? undefined,
                deviceLabel:     deviceLabel ?? undefined,
            });
            await applyCounterIdRanges(data.idRangeStart);
            // Float goes into the drawer as the shift opens.
            if (!data.resumed && totalFloat > 0) void openCashDrawer();
            if (data.resumed) {
                toast.success(`Resumed shift — ${selectedCounter?.name} · continuing from where you left off`);
            } else {
                toast.success(`Shift opened — ${selectedCounter?.name} · ₹${fmt(totalFloat)} in drawer`);
            }
            onOpened(data);
            onOpenChange(false);
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to open shift"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Monitor size={18} className="text-primary" /> Open POS shift
                    </DialogTitle>
                    <DialogDescription>
                        Select your counter. Any carry-over float from the last close is already in it.
                        Add a vault top-up if you need more opening cash.
                    </DialogDescription>
                </DialogHeader>

                {loadingCounters ? (
                    <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" size={22} /></div>
                ) : (
                    <div className="space-y-4 py-2">
                        {/* Counter picker */}
                        <div className="space-y-1.5">
                            <Label>Counter</Label>
                            <Select
                                value={selectedCounterId?.toString() ?? ""}
                                onValueChange={(v) => setSelectedCounterId(Number(v))}
                                disabled={lockedCounter != null}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select counter…" />
                                </SelectTrigger>
                                <SelectContent>
                                    {counters.map((c) => {
                                        // A counter bound to a *different* PC can't be opened here.
                                        // Only enforced when this PC has an identity (Electron or
                                        // bridge); with neither the server can't check either, so
                                        // leave it free.
                                        const boundElsewhere = !!c.boundDeviceId
                                            && !!deviceId
                                            && !matchesThisMachine(c.boundDeviceId, { machineId: deviceId });
                                        return (
                                            <SelectItem
                                                key={c.id}
                                                value={c.id.toString()}
                                                disabled={(!!c.activeShift && !onTakeover) || boundElsewhere}
                                            >
                                                <span className="flex items-center gap-2">
                                                    <Monitor size={13} />
                                                    {c.name}
                                                    {c.activeShift ? (
                                                        <span className="text-muted-foreground text-xs">
                                                            ({c.activeShift.status === "AWAITING_HANDOVER" ? "handed over" : "in use"} — {c.activeShift.user.name})
                                                        </span>
                                                    ) : boundElsewhere && (
                                                        <span className="text-muted-foreground text-xs">(locked to another computer)</span>
                                                    )}
                                                </span>
                                            </SelectItem>
                                        );
                                    })}
                                </SelectContent>
                            </Select>
                            {lockedCounter != null && (
                                <p className="text-xs text-muted-foreground">
                                    Locked to this PC. Release it from Settings → Thermal Printer → Forget, or Admin → POS Counters.
                                </p>
                            )}
                        </div>

                        {busyCounter && (
                            <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm space-y-1">
                                <p className="font-medium text-amber-900 dark:text-amber-200">
                                    {busyCounter.name} is with {busyCounter.activeShift!.user.name}
                                    {busyCounter.activeShift!.status === "AWAITING_HANDOVER" ? ", handed over" : ""}.
                                </p>
                                <p className="text-xs text-amber-800/90 dark:text-amber-300/90">
                                    Review the drawer and take it over. Accepting makes the whole drawer yours.
                                </p>
                            </div>
                        )}

                        {/* Carry-over + top-up */}
                        {selectedCounter && !busyCounter && (
                            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-2">
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Carry-over in counter</span>
                                    <span className="font-mono text-foreground font-medium">₹{fmt(carryOverRupees)}</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Vault top-up (adding now)</span>
                                    <span className="font-mono text-foreground">₹{fmt(topUpRupees)}</span>
                                </div>
                                <div className="flex justify-between font-semibold border-t border-border pt-2">
                                    <span>Total opening float</span>
                                    <span className="font-mono">₹{fmt(totalFloat)}</span>
                                </div>
                            </div>
                        )}

                        {!busyCounter && (<>
                        <div className="space-y-1.5">
                            <Label htmlFor="vault-topup" className="flex items-center gap-1.5">
                                <Banknote size={13} /> Add fresh cash from vault (₹)
                            </Label>
                            <NumericInput
                                id="vault-topup"
                                mode="decimal"
                                min={0}
                                value={vaultTopUp}
                                onValueChange={setVaultTopUp}
                                placeholder="0"
                            />
                            <p className="text-xs text-muted-foreground">
                                Leave ₹0 if the carry-over is enough. Any amount here posts a Vault → Counter Contra.
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="open-notes">Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                            <Textarea
                                id="open-notes"
                                rows={2}
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="e.g. Morning shift, Wednesday rush expected"
                            />
                        </div>
                        </>)}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                    {busyCounter && onTakeover ? (
                        <Button onClick={() => onTakeover(busyCounter.id)} disabled={loadingCounters} className="bg-amber-600 hover:bg-amber-700 text-white">
                            Review &amp; take over
                        </Button>
                    ) : (
                        <Button onClick={submit} disabled={submitting || !selectedCounterId || loadingCounters || !!busyCounter} className="bg-primary">
                            {submitting && <Loader2 size={14} className="animate-spin" />} Open shift
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
