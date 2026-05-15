"use client";

import { UserPlus } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    PartySearchAndCreate,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { type PartyHit } from "@/shared/hooks/usePartySearch";

/**
 * Wraps the existing {@link PartySearchAndCreate} widget in a dialog so the
 * Front Office can register a customer on the spot when search returns
 * nothing — without modifying `PartySearchAndCreate` itself.
 *
 * On `onPicked`, the picked party is adapted to {@link PartyHit} and
 * bubbled up via `onRegistered`, then the dialog auto-closes so the
 * Customer Context Panel can take over.
 */
interface RegisterCustomerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRegistered: (party: PartyHit) => void;
}

/** Adapter — `PartySearchAndCreate` speaks PickedParty, the rest of /lab speaks PartyHit. */
function pickedToHit(p: PickedParty): PartyHit {
    return {
        id: p.id,
        name: p.name,
        phone: p.phone ?? null,
        type: p.kind === "company" ? "company" : "customer",
        accountId: p.accountId ?? null,
    };
}

export default function RegisterCustomerDialog({
    open,
    onOpenChange,
    onRegistered,
}: RegisterCustomerDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UserPlus size={18} className="text-blue-600" />
                        Find or register customer
                    </DialogTitle>
                    <DialogDescription>
                        Search by name, phone, or email. If no match, hit{" "}
                        <kbd className="rounded border border-border bg-muted px-1 font-mono text-[11px]">
                            ↵
                        </kbd>{" "}
                        on the empty result to create a fresh customer.
                    </DialogDescription>
                </DialogHeader>

                <div className="pt-1">
                    <PartySearchAndCreate
                        autoFocus
                        partyGroup="Sundry Debtors"
                        placeholder="Type a new customer's name or phone…"
                        onPicked={(p) => {
                            onRegistered(pickedToHit(p));
                            onOpenChange(false);
                        }}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
