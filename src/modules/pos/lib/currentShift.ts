import axios from "axios";
import type { ActiveShift } from "@/modules/pos/components/ActiveShiftBar";

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
