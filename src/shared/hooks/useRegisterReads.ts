"use client";

import { useCallback, useRef, useState } from "react";

/**
 * The read bookkeeping every voucher register does, in one place.
 *
 * A register is read three ways, and they are not the same read:
 *
 *   • the first paint — there is nothing on screen yet, so a spinner is the
 *     honest answer.
 *   • a person presses Refresh — they asked for it, so the button they pressed
 *     is where it should say so.
 *   • a signal from another counter — nobody asked, so it must be invisible. A
 *     re-read that blanks a register someone is reading is the "page blinks"
 *     bug (AGENTS.md §7: show cached data while refreshing, no blank flicker).
 *
 * So `loading` here means "a read is in flight" and never "hide the rows". The
 * caller pairs it with its own row count — `loading && rows.length === 0` — and
 * the spinner then appears only when there is genuinely nothing to show.
 *
 * Lifted verbatim out of GlVoucherList, InvVoucherList and JournalEntriesRegister,
 * which each carried an identical copy of it down to the comment.
 */
export function useRegisterReads(): {
    /** Put this in the read effect's dependency list. */
    tick: number;
    /** A read is in flight. NOT a reason to unmount the rows. */
    loading: boolean;
    /** Re-read because someone asked for it — the spinner is allowed. */
    reload: () => void;
    /** Re-read because the books moved elsewhere — leaves `loading` alone. */
    refreshSilently: () => void;
    /** Call at the top of the read effect. */
    beginRead: () => void;
    /** Call in the read effect's `finally`. */
    endRead: () => void;
} {
    const [tick, setTick]       = useState(0);
    const [loading, setLoading] = useState(true);

    const silentRef = useRef(false);

    const reload          = useCallback(() => { silentRef.current = false; setTick((t) => t + 1); }, []);
    const refreshSilently = useCallback(() => { silentRef.current = true;  setTick((t) => t + 1); }, []);

    const beginRead = useCallback(() => { if (!silentRef.current) setLoading(true); }, []);

    // Back to loud afterwards: the next read is a person pressing Refresh until
    // another live signal says otherwise.
    const endRead = useCallback(() => { setLoading(false); silentRef.current = false; }, []);

    return { tick, loading, reload, refreshSilently, beginRead, endRead };
}
