"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
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
import { TallyDateTimeInput } from "@/shared/components/TallyDateTimeInput";
import { PRIORITY_META } from "@/utils/constants";
import type { LeadDetailDto, LeadPriority, LeadPositionOption } from "../lib/types";

const PRIORITIES: LeadPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const UNASSIGNED = "__none__";
const SOURCES = ["Walk-in", "Phone", "Website", "Referral", "Social", "Exhibition", "Other"];

type Linked = { kind: "person" | "company"; id: number; name: string };

function toLocalInput(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "1234.50" → 123450 paise; blank/invalid → null. */
function rupeesToPaise(v: string): number | null {
    const cleaned = v.replace(/[^0-9.]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export default function LeadFormDialog({
    open,
    onOpenChange,
    positions,
    lead,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    positions: LeadPositionOption[];
    lead?: LeadDetailDto | null;
    onSaved: () => void;
}) {
    const isEdit = Boolean(lead);
    const [title, setTitle] = useState("");
    const [contactName, setContactName] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [companyName, setCompanyName] = useState("");
    const [value, setValue] = useState("");
    const [source, setSource] = useState("");
    const [priority, setPriority] = useState<LeadPriority>("MEDIUM");
    const [assignedPositionId, setAssignedPositionId] = useState<string>(UNASSIGNED);
    const [nextFollowUpAt, setNextFollowUpAt] = useState("");
    const [notes, setNotes] = useState("");
    const [linked, setLinked] = useState<Linked | null>(null);
    const [saving, setSaving] = useState(false);

    // Customer link search
    const [linkQuery, setLinkQuery] = useState("");
    const [linkFocused, setLinkFocused] = useState(false);
    const { hits, loading: linkLoading } = usePartySearch(linkQuery, { enabled: linkFocused && !linked });

    useEffect(() => {
        if (!open) return;
        setTitle(lead?.title ?? "");
        setContactName(lead?.contactName ?? "");
        setPhone(lead?.phone ?? "");
        setEmail(lead?.email ?? "");
        setCompanyName(lead?.companyName ?? "");
        setValue(lead?.valuePaise != null ? String(lead.valuePaise / 100) : "");
        setSource(lead?.source ?? "");
        setPriority(lead?.priority ?? "MEDIUM");
        setAssignedPositionId(lead?.assignedPositionId ?? UNASSIGNED);
        setNextFollowUpAt(toLocalInput(lead?.nextFollowUpAt ?? null));
        setNotes(lead?.notes ?? "");
        setLinked(
            lead?.person
                ? { kind: "person", id: lead.person.id, name: lead.person.name }
                : lead?.company
                    ? { kind: "company", id: lead.company.id, name: lead.company.name }
                    : null,
        );
        setLinkQuery("");
    }, [open, lead]);

    const handleSave = async () => {
        if (!title.trim()) {
            toast.error("Title is required");
            return;
        }
        setSaving(true);
        const payload = {
            title: title.trim(),
            contactName: contactName.trim() || null,
            phone: phone.trim() || null,
            email: email.trim() || null,
            companyName: companyName.trim() || null,
            valuePaise: rupeesToPaise(value),
            source: source || null,
            priority,
            assignedPositionId: assignedPositionId === UNASSIGNED ? null : assignedPositionId,
            nextFollowUpAt: nextFollowUpAt || null,
            notes: notes.trim() || null,
            personId: linked?.kind === "person" ? linked.id : null,
            companyId: linked?.kind === "company" ? linked.id : null,
        };
        try {
            if (isEdit && lead) {
                await axios.patch(`/api/crm/leads/${lead.id}`, payload);
                toast.success("Lead updated");
            } else {
                await axios.post("/api/crm/leads", payload);
                toast.success("Lead created");
            }
            onOpenChange(false);
            onSaved();
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to save lead");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit lead" : "New lead"}</DialogTitle>
                    <DialogDescription>
                        {isEdit ? "Update this deal." : "Add a deal to the CRM pipeline."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="lead-title">Title</Label>
                        <Input id="lead-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 16-channel CCTV — Sharma Stores" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="lead-contact">Contact name</Label>
                            <Input id="lead-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lead-phone">Phone</Label>
                            <Input id="lead-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lead-email">Email</Label>
                            <Input id="lead-email" value={email} onChange={(e) => setEmail(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lead-company">Company</Label>
                            <Input id="lead-company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                        </div>
                    </div>

                    {/* Link existing customer (association) */}
                    <div className="space-y-2">
                        <Label>Link existing customer (optional)</Label>
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
                                    placeholder="Search person / company…"
                                />
                                {linkFocused && linkQuery.trim() && (
                                    <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
                                        {linkLoading ? (
                                            <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
                                        ) : hits.length === 0 ? (
                                            <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
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

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="lead-value">Deal value (₹)</Label>
                            <Input id="lead-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 45000" />
                        </div>
                        <div className="space-y-2">
                            <Label>Source</Label>
                            <Select value={source || UNASSIGNED} onValueChange={(v) => setSource(v === UNASSIGNED ? "" : v)}>
                                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={UNASSIGNED}>—</SelectItem>
                                    {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Priority</Label>
                            <Select value={priority} onValueChange={(v) => setPriority(v as LeadPriority)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_META[p]?.label ?? p}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Next follow-up</Label>
                            <TallyDateTimeInput value={nextFollowUpAt} onValueChange={setNextFollowUpAt} />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Owner (position)</Label>
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

                    <div className="space-y-2">
                        <Label htmlFor="lead-notes">Notes</Label>
                        <Textarea id="lead-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Context, requirements…" />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving || !title.trim()}>
                        {isEdit ? "Save changes" : "Create lead"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
