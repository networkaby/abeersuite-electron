"use client";

import { useCallback, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

/**
 * Replaces the inline `if (!confirm(...)) return; try { axios.delete; toast.success; reload } catch { toast.error }`
 * boilerplate that recurs across CRUD pages.
 *
 * Part of Pattern C. This used to call the browser's native `confirm()`, which
 * cannot be styled, looks wrong inside the desktop shell, and sat alongside a
 * properly styled dialog for the equally serious voucher delete — two different
 * looking confirmations for the same class of action. It now goes through the
 * shared confirm dialog, so every existing caller is upgraded without any change
 * to its own code.
 *
 * Usage:
 *   const { remove, deleting } = useDeleteWithConfirm({
 *     url: (id) => `/api/branches/${id}`,
 *     message: (item) => `Delete branch "${item.name}"?`,
 *     onSuccess: () => load(),
 *   });
 *   <Button disabled={deleting} onClick={() => remove(branch.id, branch)}>Delete</Button>
 */
export function useDeleteWithConfirm<T = unknown>(opts: {
    url: (id: string | number) => string;
    /** The question. Name the record — "Delete this item?" cannot be checked by the reader. */
    message?: (item?: T) => string;
    /** What else goes with it — child rows, linked records. Shown under the question. */
    detail?: (item?: T) => React.ReactNode;
    /** Label on the destructive button. Defaults to "Delete". */
    confirmLabel?: string;
    successMessage?: string;
    errorMessage?: string;
    onSuccess?: () => void;
}): {
    remove: (id: string | number, item?: T) => Promise<void>;
    deleting: boolean;
} {
    const [deleting, setDeleting] = useState(false);

    const remove = useCallback(
        async (id: string | number, item?: T) => {
            const ok = await confirmAction({
                title: opts.message?.(item) ?? "Delete this item?",
                body: opts.detail?.(item) ?? "This cannot be undone.",
                confirmLabel: opts.confirmLabel ?? "Delete",
            });
            if (!ok) return;

            setDeleting(true);
            try {
                await axios.delete(opts.url(id));
                toast.success(opts.successMessage ?? "Deleted");
                opts.onSuccess?.();
            } catch (e) {
                toast.error(extractApiError(e, opts.errorMessage ?? "Failed to delete"));
            } finally {
                setDeleting(false);
            }
        },
        [opts],
    );

    return { remove, deleting };
}
