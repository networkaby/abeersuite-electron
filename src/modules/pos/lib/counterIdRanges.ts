import { toast } from "sonner";

/**
 * Point this PC's local id sequences at the counter's reserved block, after a
 * shift is opened or taken over. Desktop app only; a no-op elsewhere. A failure
 * is told, never thrown — the shift is already open.
 */
export async function applyCounterIdRanges(idRangeStart: number | null | undefined): Promise<void> {
    if (!idRangeStart || typeof window === "undefined" || !window.electronAPI?.applyIdRanges) return;
    const applied = await window.electronAPI.applyIdRanges(idRangeStart).catch((err: unknown) => {
        console.warn("[Shift] Could not apply local id ranges:", err);
        return false;
    });
    if (!applied) {
        toast.warning("Offline writes unavailable this session — could not confirm this counter's reserved id range.");
    }
}
