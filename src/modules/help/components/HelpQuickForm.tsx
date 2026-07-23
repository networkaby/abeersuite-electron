"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Check, X } from "lucide-react";
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
import type { HelpPriority, HelpPositionOption } from "../lib/types";

const PRIORITIES: HelpPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const UNASSIGNED = "__none__";

type Linked = { kind: "person" | "company"; id: number; name: string };

const digits = (s: string) => s.replace(/\D/g, "");
const looksEmail = (s: string) => s.includes("@");

/**
 * Fast counter entry. Contact-first: type a mobile or email — if it matches an
 * existing customer, their name autofills and locks (linked); otherwise the name
 * field is yours to type (a new walk-in). Name alone (no number) is allowed. No
 * subject/type here — the office full form can enrich later.
 */
export default function HelpQuickForm({
    open,
    onOpenChange,
    positions = [],
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    positions?: HelpPositionOption[];
    onSaved: () => void;
}) {
    const [contact, setContact] = useState("");
    const [name, setName] = useState("");
    const [linked, setLinked] = useState<Linked | null>(null);
    const [notes, setNotes] = useState("");
    const [priority, setPriority] = useState<HelpPriority>("MEDIUM");
    const [assignedPositionId, setAssignedPositionId] = useState<string>(UNASSIGNED);
    const [saving, setSaving] = useState(false);

    // Look the contact up while it isn't already linked.
    const { hits } = usePartySearch(contact, { enabled: contact.trim().length >= 4 && !linked });

    useEffect(() => {
        if (!open) return;
        setContact(""); setName(""); setLinked(null); setNotes("");
        setPriority("MEDIUM"); setAssignedPositionId(UNASSIGNED);
    }, [open]);

    // Autofill on a strong match: exact phone digits, or a single email hit.
    useEffect(() => {
        if (linked || !contact.trim()) return;
        const d = digits(contact);
        const match = looksEmail(contact)
            ? (hits.length === 1 ? hits[0] : null)
            : (d.length >= 6 ? hits.find((h) => digits(h.phone ?? "") === d) ?? null : null);
        if (match) {
            setLinked({ kind: match.type === "company" ? "company" : "person", id: match.id, name: match.name });
            setName(match.name);
        }
    }, [hits, contact, linked]);

    // Editing the contact after a match breaks the link — back to free entry.
    const onContactChange = (v: string) => {
        setContact(v);
        if (linked) { setLinked(null); setName(""); }
    };
    const unlink = () => { setLinked(null); setName(""); };

    const hasCustomer = Boolean(linked) || name.trim().length > 0;

    const handleSave = async () => {
        if (!hasCustomer) { toast.error("Add a customer — a matched number, or type a name"); return; }
        setSaving(true);
        const c = contact.trim();
        const payload = linked
            ? {
                  personId: linked.kind === "person" ? linked.id : null,
                  companyId: linked.kind === "company" ? linked.id : null,
                  priority,
                  assignedPositionId: assignedPositionId === UNASSIGNED ? null : assignedPositionId,
                  notes: notes.trim() || null,
              }
            : {
                  contactName: name.trim(),
                  phone: c && !looksEmail(c) ? c : null,
                  email: c && looksEmail(c) ? c : null,
                  priority,
                  assignedPositionId: assignedPositionId === UNASSIGNED ? null : assignedPositionId,
                  notes: notes.trim() || null,
              };
        try {
            await axios.post("/api/help", payload);
            toast.success("Help ticket logged");
            onOpenChange(false);
            onSaved();
        } catch (err) {
            toast.error(extractApiError(err, "Failed to log ticket"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>New help ticket</DialogTitle>
                    <DialogDescription>Log a front-desk enquiry — the team will respond.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="help-contact">Mobile or email</Label>
                        <Input
                            id="help-contact"
                            autoFocus
                            value={contact}
                            onChange={(e) => onContactChange(e.target.value)}
                            placeholder="Type a number or email…"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="help-name">Name</Label>
                        {linked ? (
                            <div className="flex items-center justify-between rounded-md border border-green-500/40 bg-green-50 px-3 py-2 text-sm dark:bg-green-950/30">
                                <span className="flex items-center gap-1.5 font-medium">
                                    <Check className="size-4 text-green-600" /> {linked.name}
                                    <span className="text-xs font-normal text-muted-foreground">· existing {linked.kind}</span>
                                </span>
                                <button type="button" onClick={unlink} className="text-muted-foreground hover:text-foreground" title="Not this person">
                                    <X className="size-4" />
                                </button>
                            </div>
                        ) : (
                            <Input
                                id="help-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="New customer — type name"
                            />
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="help-notes">What do they need?</Label>
                        <Textarea id="help-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g. Price and stock of 16GB RAM stick" />
                    </div>

                    <div className={positions.length ? "grid grid-cols-2 gap-4" : ""}>
                        <div className="space-y-2">
                            <Label>Priority</Label>
                            <Select value={priority} onValueChange={(v) => setPriority(v as HelpPriority)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_META[p]?.label ?? p}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        {positions.length > 0 && (
                            <div className="space-y-2">
                                <Label>Handling team</Label>
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
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving || !hasCustomer}>Log ticket</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
