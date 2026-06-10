"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Plus, Check } from "lucide-react";
import { phoneError, emailError } from "@/shared/components/PartySearchAndCreate";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PhoneRow { id: number; phone: string; label: string | null; isPrimary: boolean }
interface EmailRow { id: number; email: string; label: string | null; isPrimary: boolean }

export interface PersonProfile {
    id: number;
    name: string;
    address: string | null;
    phones: PhoneRow[];
    emails: EmailRow[];
}

interface Props {
    profile: PersonProfile;
    /** Called after any save so the parent can re-fetch the detail. */
    onSaved: () => void;
}

export default function PersonProfileEdit({ profile, onSaved }: Props) {
    const [name, setName] = useState(profile.name);
    const [address, setAddress] = useState(profile.address ?? "");
    const [phones, setPhones] = useState<PhoneRow[]>(profile.phones);
    const [emails, setEmails] = useState<EmailRow[]>(profile.emails);
    const [saving, setSaving] = useState(false);
    const [addingPhone, setAddingPhone] = useState(false);
    const [newPhone, setNewPhone] = useState("");
    const [addingEmail, setAddingEmail] = useState(false);
    const [newEmail, setNewEmail] = useState("");

    const dirty = name !== profile.name || address !== (profile.address ?? "");

    // Derived — recomputed on each render, no extra state needed.
    // phoneError/emailError return null for empty strings so no guard needed.
    const phoneInputError = phoneError(newPhone.trim());
    const emailInputError = emailError(newEmail.trim());

    const saveBasic = async () => {
        if (!name.trim()) { toast.error("Name is required"); return; }
        setSaving(true);
        try {
            await axios.put(`/api/person/${profile.id}`, {
                name: name.trim(),
                address: address.trim() || null,
            });
            toast.success("Saved");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Save failed"));
        } finally {
            setSaving(false);
        }
    };

    const addPhone = async () => {
        const val = newPhone.trim();
        if (!val) return;
        const err = phoneError(val);
        if (err) { toast.error(err); return; }
        try {
            const { data } = await axios.post<PhoneRow>(`/api/person/${profile.id}/phones`, { value: val });
            setPhones(prev => [...prev, data]);
            setNewPhone("");
            setAddingPhone(false);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to add phone"));
        }
    };

    const deletePhone = async (phoneId: number) => {
        try {
            await axios.delete(`/api/person/${profile.id}/phones/${phoneId}`);
            setPhones(prev => prev.filter(p => p.id !== phoneId));
        } catch {
            toast.error("Failed to remove phone");
        }
    };

    const addEmail = async () => {
        const val = newEmail.trim();
        if (!val) return;
        const err = emailError(val);
        if (err) { toast.error(err); return; }
        try {
            const { data } = await axios.post<EmailRow>(`/api/person/${profile.id}/emails`, { value: val });
            setEmails(prev => [...prev, data]);
            setNewEmail("");
            setAddingEmail(false);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to add email"));
        }
    };

    const deleteEmail = async (emailId: number) => {
        try {
            await axios.delete(`/api/person/${profile.id}/emails/${emailId}`);
            setEmails(prev => prev.filter(e => e.id !== emailId));
        } catch {
            toast.error("Failed to remove email");
        }
    };

    return (
        <div className="space-y-6">
            {/* ── Name + Address ── */}
            <div className="space-y-3">
                <div className="space-y-1.5">
                    <Label htmlFor="pe-name">Name</Label>
                    <Input id="pe-name" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="pe-address">Address</Label>
                    <Input id="pe-address" value={address} onChange={e => setAddress(e.target.value)} placeholder="Address" />
                </div>
                {dirty && (
                    <Button size="sm" onClick={() => void saveBasic()} disabled={saving}>
                        {saving ? "Saving…" : "Save changes"}
                    </Button>
                )}
            </div>

            {/* ── Phones ── */}
            <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Phones</p>
                {phones.length === 0 && !addingPhone && (
                    <p className="text-sm text-muted-foreground">No phones added.</p>
                )}
                {phones.map(p => (
                    <div key={p.id} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
                        <span className="flex-1 font-medium">{p.phone}</span>
                        {p.isPrimary && <span className="shrink-0 text-[10px] text-primary">Primary</span>}
                        {p.label && <span className="shrink-0 text-xs text-muted-foreground">{p.label}</span>}
                        <Button
                            onClick={() => void deletePhone(p.id)}
                            variant="ghost"
                            size="icon-xs"
                            className="shrink-0 text-muted-foreground/40 hover:text-destructive"
                        >
                            <X size={13} />
                        </Button>
                    </div>
                ))}
                {addingPhone ? (
                    <div className="space-y-1">
                        <div className="flex gap-2">
                            <Input
                                value={newPhone}
                                onChange={e => setNewPhone(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === "Enter") { void addPhone(); }
                                    if (e.key === "Escape") { setAddingPhone(false); setNewPhone(""); }
                                }}
                                placeholder="Phone number"
                                autoFocus
                                className={`flex-1 ${phoneInputError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                            />
                            <Button
                                onClick={() => void addPhone()}
                                size="sm"
                                disabled={!newPhone.trim() || !!phoneInputError}
                            >
                                <Check size={13} />
                            </Button>
                            <Button onClick={() => { setAddingPhone(false); setNewPhone(""); }} variant="ghost" size="icon-sm">
                                <X size={14} />
                            </Button>
                        </div>
                        {phoneInputError && (
                            <p className="text-xs text-destructive">{phoneInputError}</p>
                        )}
                    </div>
                ) : (
                    <Button onClick={() => setAddingPhone(true)} variant="link" size="xs" className="h-auto p-0 text-xs">
                        <Plus size={13} /> Add phone
                    </Button>
                )}
            </div>

            {/* ── Emails ── */}
            <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Emails</p>
                {emails.length === 0 && !addingEmail && (
                    <p className="text-sm text-muted-foreground">No emails added.</p>
                )}
                {emails.map(em => (
                    <div key={em.id} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
                        <span className="flex-1">{em.email}</span>
                        {em.isPrimary && <span className="shrink-0 text-[10px] text-primary">Primary</span>}
                        {em.label && <span className="shrink-0 text-xs text-muted-foreground">{em.label}</span>}
                        <Button
                            onClick={() => void deleteEmail(em.id)}
                            variant="ghost"
                            size="icon-xs"
                            className="shrink-0 text-muted-foreground/40 hover:text-destructive"
                        >
                            <X size={13} />
                        </Button>
                    </div>
                ))}
                {addingEmail ? (
                    <div className="space-y-1">
                        <div className="flex gap-2">
                            <Input
                                value={newEmail}
                                onChange={e => setNewEmail(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === "Enter") { void addEmail(); }
                                    if (e.key === "Escape") { setAddingEmail(false); setNewEmail(""); }
                                }}
                                placeholder="Email address"
                                autoFocus
                                className={`flex-1 ${emailInputError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                            />
                            <Button
                                onClick={() => void addEmail()}
                                size="sm"
                                disabled={!newEmail.trim() || !!emailInputError}
                            >
                                <Check size={13} />
                            </Button>
                            <Button onClick={() => { setAddingEmail(false); setNewEmail(""); }} variant="ghost" size="icon-sm">
                                <X size={14} />
                            </Button>
                        </div>
                        {emailInputError && (
                            <p className="text-xs text-destructive">{emailInputError}</p>
                        )}
                    </div>
                ) : (
                    <Button onClick={() => setAddingEmail(true)} variant="link" size="xs" className="h-auto p-0 text-xs">
                        <Plus size={13} /> Add email
                    </Button>
                )}
            </div>
        </div>
    );
}
