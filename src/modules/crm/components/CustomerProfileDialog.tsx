"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
    User, Building2, PhoneCall, Copy, Check, MapPin, ExternalLink,
    ShieldAlert, Ticket as TicketIcon, UserPlus, CreditCard
} from "lucide-react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CustomerAvatar } from "./CustomerAvatar";
import { formatInr, formatDrCr } from "@/shared/lib/format/moneyInr";
import { cn } from "@/shared/lib/format/utils";

export type CustomerProfileData = {
    kind: "person" | "company";
    id: number;
    name: string;
    avatarUrl?: string | null;
    address?: string | null;
    accountId?: number | null;
    balance?: number | null;
    normalBalance?: "DEBIT" | "CREDIT" | null;
};

export interface CustomerProfileDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    customer: CustomerProfileData | null;
    phone: string;
    senderName: string | null;
    spam: boolean;
    ticket: {
        id: number;
        title: string | null;
        priority: string;
        status: string | null;
        assignee: string | null;
    } | null;
    onToggleSpam: () => void;
    onCreateParty: () => void;
}

export function CustomerProfileDialog({
    open,
    onOpenChange,
    customer,
    phone,
    senderName,
    spam,
    ticket,
    onToggleSpam,
    onCreateParty,
}: CustomerProfileDialogProps) {
    const [copied, setCopied] = useState(false);

    const displayName = customer?.name ?? senderName ?? `+91 ${phone}`;

    function copyPhone() {
        const full = `+91${phone}`;
        navigator.clipboard.writeText(full).then(() => {
            setCopied(true);
            toast.success("Phone number copied");
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => toast.error("Could not copy number"));
    }

    const partyUrl = customer
        ? `/office/customers/all?${customer.kind === "person" ? "personId" : "companyId"}=${customer.id}`
        : null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md w-full p-5 sm:p-6 sm:rounded-2xl">
                <DialogHeader className="items-center text-center pb-2">
                    <CustomerAvatar
                        name={displayName}
                        avatarUrl={customer?.avatarUrl}
                        kind={customer?.kind}
                        phone={phone}
                        sizePx={72}
                        className="mb-2 shadow-sm"
                    />
                    <DialogTitle className="text-lg font-bold truncate max-w-full">
                        {displayName}
                    </DialogTitle>
                    <DialogDescription className="text-xs flex items-center justify-center gap-1.5 flex-wrap">
                        {customer ? (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                                {customer.kind === "company" ? <Building2 className="size-3" /> : <User className="size-3" />}
                                Customer ({customer.kind === "company" ? "Company" : "Person"})
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                Not a party yet
                            </span>
                        )}
                        {spam && (
                            <span className="inline-flex items-center gap-1 rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
                                <ShieldAlert className="size-3" /> Spam
                            </span>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3.5 text-sm">
                    {/* Financial balance card if customer has an account */}
                    {customer?.balance != null && (
                        <div className="rounded-xl border bg-card p-3.5 shadow-2xs">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                                    <CreditCard className="size-3.5 text-primary" />
                                    Outstanding Balance
                                </div>
                                {partyUrl && (
                                    <a
                                        href={partyUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-primary hover:underline flex items-center gap-1"
                                    >
                                        Ledger <ExternalLink className="size-3" />
                                    </a>
                                )}
                            </div>
                            <div className="mt-1.5 flex items-baseline gap-2">
                                <span className={cn(
                                    "text-xl font-bold tracking-tight",
                                    customer.balance > 0 ? "text-amber-600 dark:text-amber-400" :
                                    customer.balance < 0 ? "text-green-600 dark:text-green-400" :
                                    "text-foreground"
                                )}>
                                    {formatInr(Math.abs(customer.balance), 2)}
                                </span>
                                <span className="text-xs font-semibold text-muted-foreground uppercase">
                                    {customer.balance === 0 ? "Nil" : formatDrCr(customer.balance, customer.normalBalance ?? "DEBIT")}
                                </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {customer.balance > 0
                                    ? "Customer owes this amount"
                                    : customer.balance < 0
                                    ? "Advance / credit balance available"
                                    : "All dues settled"}
                            </p>
                        </div>
                    )}

                    {/* WhatsApp & Contact Details */}
                    <div className="rounded-xl border bg-muted/20 p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">WhatsApp Number</div>
                                <div className="font-semibold text-foreground">+91 {phone}</div>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button size="sm" variant="outline" className="h-8 px-2 text-xs" asChild>
                                    <a href={`tel:+91${phone}`} title="Call customer">
                                        <PhoneCall className="size-3.5 text-green-600 mr-1" />
                                        Call
                                    </a>
                                </Button>
                                <Button size="sm" variant="ghost" className="size-8 p-0" onClick={copyPhone} title="Copy phone number">
                                    {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5 text-muted-foreground" />}
                                </Button>
                            </div>
                        </div>

                        {senderName && senderName !== customer?.name && (
                            <div className="pt-2 border-t">
                                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">WhatsApp Profile Name</div>
                                <div className="text-sm text-foreground">{senderName}</div>
                            </div>
                        )}

                        {customer?.address && (
                            <div className="pt-2 border-t">
                                <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                                    <MapPin className="size-3" /> Address
                                </div>
                                <div className="text-sm text-foreground mt-0.5 leading-snug">{customer.address}</div>
                            </div>
                        )}
                    </div>

                    {/* Open Ticket (if any) */}
                    {ticket && (
                        <div className="rounded-xl border border-sky-200 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/20 p-3 space-y-1">
                            <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-sky-800 dark:text-sky-200 flex items-center gap-1">
                                    <TicketIcon className="size-3.5" /> Ticket #{ticket.id}
                                </span>
                                {ticket.status && (
                                    <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-900 dark:text-sky-200">
                                        {ticket.status}
                                    </span>
                                )}
                            </div>
                            {ticket.title && <p className="text-xs text-foreground font-medium truncate">{ticket.title}</p>}
                            {ticket.assignee && (
                                <p className="text-[11px] text-muted-foreground">Assigned to: {ticket.assignee}</p>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="mt-4 flex flex-col sm:flex-row gap-2 pt-2 border-t">
                    {!customer ? (
                        <Button
                            className="flex-1"
                            onClick={() => {
                                onOpenChange(false);
                                onCreateParty();
                            }}
                        >
                            <UserPlus className="mr-1.5 size-4" />
                            Create CRM Party
                        </Button>
                    ) : partyUrl ? (
                        <Button variant="default" className="flex-1" asChild>
                            <a href={partyUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="mr-1.5 size-4" />
                                Open Party Details
                            </a>
                        </Button>
                    ) : null}

                    <Button
                        variant={spam ? "secondary" : "outline"}
                        className={cn("sm:w-auto", spam && "text-muted-foreground")}
                        onClick={onToggleSpam}
                    >
                        <ShieldAlert className={cn("mr-1.5 size-4", spam ? "text-muted-foreground" : "text-destructive")} />
                        {spam ? "Not Spam" : "Mark Spam"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default CustomerProfileDialog;
