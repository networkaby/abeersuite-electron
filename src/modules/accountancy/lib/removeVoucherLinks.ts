// Remove every bill-wise link a voucher takes part in — the "Remove link" line
// on a Settled chip's right-click menu. Both vouchers stay as they are; only the
// matching goes, so both ends reopen and can be linked again.
//
// One DELETE per link through the existing allocations API, so each removal is
// permission-checked (`cancel` on both kinds) and audited exactly as before.

import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";

export async function removeVoucherLinks(voucherId: number): Promise<boolean> {
    let done = 0;
    try {
        const { data } = await axios.get<{ id: number }[]>("/api/accountancy/allocations", { params: { voucherId } });
        for (const l of data) {
            await axios.delete(`/api/accountancy/allocations/${l.id}`);
            done++;
        }
        toast.success(done === 0 ? "No links to remove." : done === 1 ? "Link removed." : `${done} links removed.`);
    } catch (e) {
        toast.error(extractApiError(e, "Could not remove the link"));
    }
    return done > 0;
}
