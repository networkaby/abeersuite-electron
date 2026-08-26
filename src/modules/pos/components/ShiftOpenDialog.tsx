"use client";

// ── ShiftOpenDialog ──────────────────────────────────────────────────────────
// Shown by PosScreen when the cashier has no active shift at this branch.
// Cashier picks a counter, sees the carry-over balance already sitting in it,
// optionally adds a vault top-up, then opens the shift.
//
// Opening Contra (Vault → Counter till) is posted ONLY for the top-up portion.
// If the counter already has a carry-over float the cashier just starts billing.

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmt } from "@/utils/constants";
import { extractApiError } from "@/shared/lib/api";
import { resolveMachineIdentity, matchesThisMachine } from "@/shared/lib/counter/identity";

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
    open, onOpenChange, onOpened,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpened: (shift: OpenedShift) => void;
}) {
    const [counters, setCounters]         = useState<Counter[]>([]);
    const [loadingCounters, setLoadingCounters] = useState(false);
    const [selectedCounterId, setSelectedCounterId] = useState<number | null>(null);
    // This PC's identity — Electron's installation id when available, else the local
    // bridge's id. The counter this device is bound to server-side forces + disables
    // the picker. legacyDeviceId only matters during the bridge->Electron migration.
    const [deviceId, setDeviceId]         = useState<string | null>(null);
    const [legacyDeviceId, setLegacyDeviceId] = useState<string | null>(null);
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

        // This PC's identity. The server binds the counter to it on first open; a
        // later open elsewhere is refused. Best-effort — if neither Electron nor the
        // bridge answers, no device lock this session (free picker).
        resolveMachineIdentity().then(({ machineId, legacyDeviceId: legacy, deviceLabel: label }) => {
            setDeviceId(machineId);
            setLegacyDeviceId(legacy);
            setDeviceLabel(label);
        });
    }, [open]);

    // The counter this PC is bound to (server-side). When set, the picker is
    // forced to it and locked. Matches either the canonical id or, during the
    // bridge->Electron migration, the older bridge-minted one.
    const lockedCounter = (deviceId || legacyDeviceId)
        ? counters.find((c) => matchesThisMachine(c.boundDeviceId, { machineId: deviceId, legacyDeviceId })) ?? null
        : null;
    useEffect(() => {
        if (lockedCounter) setSelectedCounterId(lockedCounter.id);
    }, [lockedCounter]);

    const selectedCounter = counters.find((c) => c.id === selectedCounterId) ?? null;
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
                // The server binds this counter to the PC on first open (device lock).
                // legacyDeviceId lets it recognise + migrate a counter still bound
                // under the pre-Electron bridge id.
                deviceId:        deviceId ?? legacyDeviceId ?? undefined,
                legacyDeviceId:  (legacyDeviceId && legacyDeviceId !== deviceId) ? legacyDeviceId : undefined,
                deviceLabel:     deviceLabel ?? undefined,
            });
            if (data.idRangeStart && typeof window !== "undefined" && window.electronAPI?.applyIdRanges) {
                window.electronAPI.applyIdRanges(data.idRangeStart).catch((err: unknown) => {
                    console.warn("[ShiftOpen] Could not apply local id ranges:", err);
                });
            }
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
                                            && (!!deviceId || !!legacyDeviceId)
                                            && !matchesThisMachine(c.boundDeviceId, { machineId: deviceId, legacyDeviceId });
                                        return (
                                            <SelectItem
                                                key={c.id}
                                                value={c.id.toString()}
                                                disabled={!!c.activeShift || boundElsewhere}
                                            >
                                                <span className="flex items-center gap-2">
                                                    <Monitor size={13} />
                                                    {c.name}
                                                    {c.activeShift ? (
                                                        <span className="text-muted-foreground text-xs">
                                                            ({c.activeShift.status === "AWAITING_HANDOVER" ? "awaiting handover" : `in use — ${c.activeShift.user.name}`})
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

                        {/* Carry-over + top-up */}
                        {selectedCounter && (
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

                        <div className="space-y-1.5">
                            <Label htmlFor="vault-topup" className="flex items-center gap-1.5">
                                <Banknote size={13} /> Add fresh cash from vault (₹)
                            </Label>
                            <Input
                                id="vault-topup"
                                type="text"
                                inputMode="decimal"
                                value={vaultTopUp}
                                onChange={(e) => setVaultTopUp(e.target.value.replace(/[^\d.]/g, ""))}
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
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                    <Button onClick={submit} disabled={submitting || !selectedCounterId || loadingCounters} className="bg-primary">
                        {submitting && <Loader2 size={14} className="animate-spin" />} Open shift
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
