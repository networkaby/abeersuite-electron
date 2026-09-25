import axios from "axios";
import type { ActiveShift } from "@/modules/pos/components/ActiveShiftBar";
import type { CounterTakeover } from "@/modules/pos/components/ShiftTakeoverDialog";

/**
 * The signed-in cashier's running shift, or null.
 *
 * A shift waiting for a handover that nobody has taken yet means its own cashier
 * came back: the handover is dropped and they carry on as if it never happened
 * (owner, 2026-09-24). If that cannot be done right now (offline), the waiting
 * shift is returned as it is and the amber bar offers the cancel by hand.
 */
export async function fetchCurrentShift(): Promise<ActiveShift | null> {
    const { data } = await axios.get<ActiveShift | null>("/api/pos/shifts/current");
    if (data?.status !== "AWAITING_HANDOVER") return data;
    try {
        await axios.delete(`/api/pos/shifts/${data.id}/handover`);
        return (await axios.get<ActiveShift | null>("/api/pos/shifts/current")).data;
    } catch {
        return data;
    }
}

/**
 * Somebody else's drawer waiting on this PC's counter, or null.
 *
 * Both questions go out together — the caller's own shift and the counter's —
 * so the answer costs one round trip, not two. A cashier with a shift of their
 * own (A coming back) never sees a takeover. Any failure answers null: the POS
 * screen asks again on its own.
 */
export async function fetchCounterTakeover(counterId?: number): Promise<CounterTakeover | null> {
    const q = counterId ? `?counterId=${counterId}` : "";
    const [own, t] = await Promise.all([
        axios.get<ActiveShift | null>("/api/pos/shifts/current").then((r) => r.data).catch(() => null),
        axios.get<CounterTakeover | null>(`/api/pos/shifts/counter-takeover${q}`).then((r) => r.data).catch(() => null),
    ]);
    return own ? null : t;
}
