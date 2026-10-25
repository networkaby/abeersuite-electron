"use client";

// ── usePosShift ─────────────────────────────────────────────────────────────
// The active POS shift part of usePosBilling: this cashier's shift, a drawer
// waiting to be taken over on this counter, and the shift dialogs' open flags.
// usePosBilling calls it at the same point its own state used to sit, so the
// hook order (and React's state for each hook) is unchanged.

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { type ActiveShift } from "@/modules/pos/components/ActiveShiftBar";
import { type CounterTakeover } from "@/modules/pos/components/ShiftTakeoverDialog";
import { fetchCurrentShift } from "@/modules/pos/lib/currentShift";

export function usePosShift() {
    // Mount order:
    //   1. fetchCurrentShift() — this cashier's own shift. One they had handed
    //      over and nobody took is quietly resumed (they came back).
    //      → found : billing enabled
    //      → null  : is somebody else's drawer on this counter? ↓
    //   2. GET /api/pos/shifts/counter-takeover (this PC's counter)
    //      → found : ShiftTakeoverDialog — accept the drawer or sign out
    //      → null  : fresh start from the ShiftOpenDialog
    const [activeShift, setActiveShift] = useState<ActiveShift | null>(null);
    // `fromPicker` — chosen in the open-shift dialog (Reject goes back) rather
    // than found on sign-in at this counter (Reject signs out).
    const [takeover, setTakeover] = useState<{ data: CounterTakeover; fromPicker: boolean } | null>(null);
    const [shiftLoaded, setShiftLoaded] = useState(false);
    const [shiftOpenDialogOpen, setShiftOpenDialogOpen] = useState(false);
    const [returnDialogOpen, setReturnDialogOpen] = useState(false);
    const [expenditureDialogOpen, setExpenditureDialogOpen] = useState(false);
    const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
    // Shift drop / close — launched from the header ⋮ menu.
    const [shiftDropOpen, setShiftDropOpen] = useState(false);
    const [shiftCloseOpen, setShiftCloseOpen] = useState(false);

    const refreshActiveShift = useCallback(() => {
        // Both asked at once; the counter's answer only counts when there is no
        // shift of their own.
        const counterP = axios.get<CounterTakeover | null>("/api/pos/shifts/counter-takeover")
            .then((r) => r.data).catch(() => null);
        fetchCurrentShift()
            .then(async (shift) => {
                setActiveShift(shift);
                const t = shift ? null : await counterP;
                setTakeover(t ? { data: t, fromPicker: false } : null);
            })
            .catch(() => { setActiveShift(null); setTakeover(null); })
            .finally(() => setShiftLoaded(true));
    }, []);

    // A busy counter picked in the open-shift dialog.
    const openTakeover = useCallback(async (counterId: number) => {
        try {
            const t = await axios.get<CounterTakeover | null>(`/api/pos/shifts/counter-takeover?counterId=${counterId}`);
            if (t.data) setTakeover({ data: t.data, fromPicker: true });
            else toast.info("That counter is free now — open a shift on it.");
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Could not read that counter"));
        }
    }, []);

    useEffect(() => {
        refreshActiveShift();
    }, [refreshActiveShift]);

    return {
        activeShift, setActiveShift, takeover, setTakeover, shiftLoaded,
        shiftOpenDialogOpen, setShiftOpenDialogOpen,
        returnDialogOpen, setReturnDialogOpen,
        expenditureDialogOpen, setExpenditureDialogOpen,
        receiptDialogOpen, setReceiptDialogOpen,
        shiftDropOpen, setShiftDropOpen,
        shiftCloseOpen, setShiftCloseOpen,
        refreshActiveShift, openTakeover,
    };
}
