"use client";

import { useEffect, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { subscribeConfirm, type PendingConfirm } from "@/shared/lib/ui/confirmStore";

/**
 * The one confirmation dialog for the whole app — mounted once in the root
 * layout so that `confirmAction()` works from anywhere with nothing to wire up.
 *
 * Cancel takes the initial focus, so Enter never confirms a destructive action by
 * accident. At counter speed that matters more than saving a keystroke.
 */
export default function ConfirmHost() {
    const [pending, setPending] = useState<PendingConfirm | null>(null);

    useEffect(() => subscribeConfirm(setPending), []);

    return (
        <Dialog
            open={pending !== null}
            onOpenChange={(open) => {
                // Escape, the X, or a click outside all mean "no".
                if (!open) pending?.settle(false);
            }}
        >
            <DialogContent className="sm:max-w-md" key={pending?.id ?? "none"}>
                <DialogHeader>
                    <DialogTitle>{pending?.title ?? ""}</DialogTitle>
                    {pending?.body ? (
                        <DialogDescription asChild>
                            <div className="text-sm text-muted-foreground">{pending.body}</div>
                        </DialogDescription>
                    ) : null}
                </DialogHeader>
                <DialogFooter className="gap-2 sm:gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        autoFocus
                        onClick={() => pending?.settle(false)}
                    >
                        {pending?.cancelLabel ?? "Cancel"}
                    </Button>
                    <Button
                        type="button"
                        variant={pending?.destructive === false ? "default" : "destructive"}
                        onClick={() => pending?.settle(true)}
                    >
                        {pending?.confirmLabel ?? "Confirm"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
