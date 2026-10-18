// A service centre is a Sundry-Creditor party (Account), never a separate master.
// Two flows record one on the soft Ticket.context bag: the shipping slip
// (`shippingSlip.partyName`) and Escalate (`escalatedTo`). The latest slip wins.

export type EscalatedTo = { accountId: number; name: string };

/** Ticket.context as a plain object — `{}` when unset or not an object. */
export function ticketContext(context: unknown): Record<string, unknown> {
    return context && typeof context === "object" && !Array.isArray(context) ? (context as Record<string, unknown>) : {};
}

/** The centre a device was sent to, read off Ticket.context — null when none. */
export function serviceCentreName(context: unknown): string | null {
    const ctx = ticketContext(context) as { shippingSlip?: { partyName?: string | null } | null; escalatedTo?: Partial<EscalatedTo> | null };
    return ctx.shippingSlip?.partyName || ctx.escalatedTo?.name || null;
}
