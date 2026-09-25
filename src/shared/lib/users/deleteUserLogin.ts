"use client";

import axios from "axios";
import { toast } from "sonner";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { extractApiError } from "@/shared/lib/api/extractApiError";

/**
 * Delete a staff login — the one path Admin → Users and HR → Staff Directory
 * share, so the warning and the result read the same on both. The write
 * announces `settings`, which is what refreshes the other page.
 *
 * True when the login is gone; false when cancelled or refused (toast shown).
 */
export async function confirmAndDeleteUser(user: { id: number; name: string }): Promise<boolean> {
    const ok = await confirmAction({
        title: `Delete ${user.name}'s login?`,
        body: "Their login, seats, HR profile and salary history go with them. To keep the record, mark them as left on their HR profile instead.",
        confirmLabel: "Delete",
    });
    if (!ok) return false;
    try {
        await axios.delete(`/api/users/${user.id}`);
        toast.success(`${user.name} deleted`);
        return true;
    } catch (e) {
        toast.error(extractApiError(e, "Could not delete this login"));
        return false;
    }
}
