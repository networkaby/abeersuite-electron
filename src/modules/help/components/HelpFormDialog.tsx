"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { usePartySearch } from "@/shared/hooks/usePartySearch";
import { PRIORITY_META } from "@/utils/constants";
import { INQUIRY_TYPES, type HelpDetailDto, type HelpInquiryType, type HelpPriority, type HelpPositionOption } from "../lib/types";

const PRIORITIES: HelpPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const UNASSIGNED = "__none__";

type Linked = { kind: "person" | "company"; id: number; name: string };

export default function HelpFormDialog({
    open,
    onOpenChange,
    positions,
    ticket,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    positions: HelpPositionOption[];
    ticket?: HelpDetailDto | null;
    onSaved: () => void;
}) {
    const isEdit = Boolean(ticket);
    const [subject, setSubject] = useState("");
    const [inquiryType, setInquiryType] = useState<HelpInquiryType>("OTHER");
    const [contactName, setContactName] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [priority, setPriority] = useState<HelpPriority>("MEDIUM");
    const [assignedPositionId, setAssignedPositionId] = useState<string>(UNASSIGNED);
    const [notes, setNotes] = useState("");
    const [linked, setLinked] = useState<Linked | null>(null);
    const [saving, setSaving] = useState(false);

    // Customer link search (existing party)
    const [linkQuery, setLinkQuery] = useState("");
    const [linkFocused, setLinkFocused] = useState(false);
    const { hits, loading: linkLoading } = usePartySearch(linkQuery, { enabled: linkFocused && !linked });

    useEffect(() => {
        if (!open) return;
        setSubject(ticket?.subject ?? "");
        setInquiryType((ticket?.inquiryType as HelpInquiryType) ?? "OTHER");
        setContactName(ticket?.contactName ?? "");
        setPhone(ticket?.phone ?? "");
        setEmail(ticket?.email ?? "");
        setPriority(ticket?.priority ?? "MEDIUM");
        setAssignedPositionId(ticket?.assignedPositionId ?? UNASSIGNED);
        setNotes(ticket?.notes ?? "");
        setLinked(
            ticket?.person
                ? { kind: "person", id: ticket.person.id, name: ticket.person.name }
                : ticket?.company
                    ? { kind: "company", id: ticket.company.id, name: ticket.company.name }
                    : null,
        );
        setLinkQuery("");
    }, [open, ticket]);

    const hasCustomer = Boolean(linked) || contactName.trim().length > 0;

    const handleSave = async () => {
        if (!hasCustomer) { toast.error("Add a customer — search an existing one or type a new name"); return; }
        setSaving(true);
        const payload = {
            subject: subject.trim() || null,
            inquiryType,
            contactName: contactName.trim() || null,
            phone: phone.trim() || null,
            email: email.trim() || null,
            priority,
            assignedPositionId: assignedPositionId === UNASSIGNED ? null : assignedPositionId,
            notes: notes.trim() || null,
            personId: linked?.kind === "person" ? linked.id : null,
            companyId: linked?.kind === "company" ? linked.id : null,
        };
        try {
            if (isEdit && ticket) {
                await axios.patch(`/api/help/${ticket.id}`, payload);
                toast.success("Help ticket updated");
            } else {
                await axios.post("/api/help", payload);
                toast.success("Help ticket logged");
            }
            onOpenChange(false);
            onSaved();
        } catch (err) {
            toast.error(extractApiError(err, "Failed to save help ticket"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit help ticket" : "New help ticket"}</DialogTitle>
                    <DialogDescription>
                        {isEdit ? "Update this enquiry." : "Log a front-desk enquiry for the team to respond to."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid grid-cols-[1fr_160px] gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="help-subject">Subject</Label>
                            <Input id="help-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Price of 16GB RAM stick" />
                        </div>
                        <div className="space-y-2">
                            <Label>Type</Label>
                            <Select value={inquiryType} onValueChange={(v) => setInquiryType(v as HelpInquiryType)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {INQUIRY_TYPES.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Link existing customer */}
                    <div className="space-y-2">
                        <Label>Customer</Label>
                        {linked ? (
                            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                                <span>
                                    <span className="font-medium">{linked.name}</span>
                                    <span className="ml-1 text-xs text-muted-foreground">({linked.kind})</span>
                                </span>
                                <button type="button" onClick={() => setLinked(null)} className="text-muted-foreground hover:text-foreground">
                                    <X className="size-4" />
                                </button>
                            </div>
                        ) : (
                            <div className="relative">
                                <Input
                                    value={linkQuery}
                                    onChange={(e) => setLinkQuery(e.target.value)}
                                    onFocus={() => setLinkFocused(true)}
                                    onBlur={() => setTimeout(() => setLinkFocused(false), 150)}
                                    placeholder="Search existing person / company…"
                                />
                                {linkFocused && linkQuery.trim() && (
                                    <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
                                        {linkLoading ? (
                                            <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
                                        ) : hits.length === 0 ? (
                                            <p className="px-3 py-2 text-xs text-muted-foreground">No matches — type the new customer below</p>
                                        ) : (
                                            hits.map((h) => (
                                                <button
                                                    key={`${h.type}-${h.id}`}
                                                    type="button"
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={() => {
                                                        setLinked({ kind: h.type === "company" ? "company" : "person", id: h.id, name: h.name });
                                                        setLinkQuery("");
                                                    }}
                                                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-muted"
                                                >
                                                    <span>{h.name}</span>
                                                    <span className="text-xs text-muted-foreground">{h.phone ?? h.type}</span>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* New walk-in (only when no existing party is linked) */}
                    {!linked && (
                        <div className="grid grid-cols-2 gap-4 rounded-md border border-dashed p-3">
                            <div className="col-span-2 -mb-1 text-xs text-muted-foreground">…or a new walk-in</div>
                            <div className="space-y-2">
                                <Label htmlFor="help-contact">Name</Label>
                                <Input id="help-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Customer name" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="help-phone">Phone</Label>
                                <Input id="help-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile" />
                            </div>
                            <div className="col-span-2 space-y-2">
                                <Label htmlFor="help-email">Email (optional)</Label>
                                <Input id="help-email" value={email} onChange={(e) => setEmail(e.target.value)} />
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Priority</Label>
                            <Select value={priority} onValueChange={(v) => setPriority(v as HelpPriority)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_META[p]?.label ?? p}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Handling team (position)</Label>
                            <Select value={assignedPositionId} onValueChange={setAssignedPositionId}>
                                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                                    {positions.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.title}{p.branchName ? ` · ${p.branchName}` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="help-notes">Notes</Label>
                        <Textarea id="help-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="What did they ask? Any context…" />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving || !hasCustomer}>
                        {isEdit ? "Save changes" : "Log ticket"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
