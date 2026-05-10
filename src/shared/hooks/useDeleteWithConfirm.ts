"use client";

import { useCallback, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

/**
 * Replaces the inline `if (!confirm(...)) return; try { axios.delete; toast.success; reload } catch { toast.error }`
 * boilerplate that recurs across CRUD pages.
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
    message?: (item?: T) => string;
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
            const confirmMsg = opts.message?.(item) ?? "Delete this item?";
            if (!confirm(confirmMsg)) return;
            setDeleting(true);
            try {
                await axios.delete(opts.url(id));
                toast.success(opts.successMessage ?? "Deleted");
                opts.onSuccess?.();
            } catch (e) {
                const msg =
                    axios.isAxiosError(e) && typeof e.response?.data?.error === "string"
                        ? e.response.data.error
                        : opts.errorMessage ?? "Failed to delete";
                toast.error(msg);
            } finally {
                setDeleting(false);
            }
        },
        [opts],
    );

    return { remove, deleting };
}
