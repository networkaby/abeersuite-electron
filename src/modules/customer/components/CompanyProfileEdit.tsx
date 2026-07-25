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

// Company phones/emails come from getCompanyContacts which normalises to `value`.
interface ContactRow { id: number; value: string; label: string | null; isPrimary: boolean }

// The POST /api/companies/[id]/phones response still returns the Prisma shape.
interface PhoneApiRow { id: number; phone: string; label: string | null; isPrimary: boolean }
interface EmailApiRow { id: number; email: string; label: string | null; isPrimary: boolean }

export interface CompanyProfile {
    id: number;
    name: string;
    address: string | null;
    companyReg: string | null;
    taxId: string | null;
    phones: ContactRow[];
    emails: ContactRow[];
}

interface Props {
    profile: CompanyProfile;
    /** Called after any save so the parent can re-fetch the detail. */
    onSaved: () => void;
}

export default function CompanyProfileEdit({ profile, onSaved }: Props) {
    const [name, setName] = useState(profile.name);
    const [address, setAddress] = useState(profile.address ?? "");
    const [companyReg, setCompanyReg] = useState(profile.companyReg ?? "");
    const [taxId, setTaxId] = useState(profile.taxId ?? "");
    const [phones, setPhones] = useState<ContactRow[]>(profile.phones);
    const [emails, setEmails] = useState<ContactRow[]>(profile.emails);
    const [saving, setSaving] = useState(false);
    const [addingPhone, setAddingPhone] = useState(false);
    const [newPhone, setNewPhone] = useState("");
    const [addingEmail, setAddingEmail] = useState(false);
    const [newEmail, setNewEmail] = useState("");

    const dirty =
        name !== profile.name ||
        address !== (profile.address ?? "") ||
        companyReg !== (profile.companyReg ?? "") ||
        taxId !== (profile.taxId ?? "");

    // Derived — recomputed on each render, no extra state needed.
    // phoneError/emailError return null for empty strings so no guard needed.
    const phoneInputError = phoneError(newPhone.trim());
    const emailInputError = emailError(newEmail.trim());

    const saveBasic = async () => {
        if (!name.trim()) { toast.error("Company name is required"); return; }
        setSaving(true);
        try {
            await axios.put(`/api/companies/${profile.id}`, {
                name: name.trim(),
                address: address.trim() || null,
                companyReg: companyReg.trim() || null,
                taxId: taxId.trim() || null,
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
            const { data } = await axios.post<PhoneApiRow>(`/api/companies/${profile.id}/phones`, { value: val });
            setPhones(prev => [...prev, { id: data.id, value: data.phone, label: data.label, isPrimary: data.isPrimary }]);
            setNewPhone("");
            setAddingPhone(false);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to add phone"));
        }
    };

    const deletePhone = async (phoneId: number) => {
        try {
            await axios.delete(`/api/companies/${profile.id}/phones/${phoneId}`);
            setPhones(prev => prev.filter(p => p.id !== phoneId));
        } catch {
            toast.error("Failed to remove phone");
        }
    };

    const makePhonePrimary = async (phoneId: number) => {
        try {
            await axios.patch(`/api/companies/${profile.id}/phones/${phoneId}`, { isPrimary: true });
            setPhones(prev => prev.map(p => ({ ...p, isPrimary: p.id === phoneId })));
        } catch (e) {
            toast.error(extractApiError(e, "Failed to set primary phone"));
        }
    };

    const addEmail = async () => {
        const val = newEmail.trim();
        if (!val) return;
        const err = emailError(val);
        if (err) { toast.error(err); return; }
        try {
            const { data } = await axios.post<EmailApiRow>(`/api/companies/${profile.id}/emails`, { value: val });
            setEmails(prev => [...prev, { id: data.id, value: data.email, label: data.label, isPrimary: data.isPrimary }]);
            setNewEmail("");
            setAddingEmail(false);
        } catch (e) {
            toast.error(extractApiError(e, "Failed to add email"));
        }
    };

    const deleteEmail = async (emailId: number) => {
        try {
            await axios.delete(`/api/companies/${profile.id}/emails/${emailId}`);
            setEmails(prev => prev.filter(e => e.id !== emailId));
        } catch {
            toast.error("Failed to remove email");
        }
    };

    const makeEmailPrimary = async (emailId: number) => {
        try {
            await axios.patch(`/api/companies/${profile.id}/emails/${emailId}`, { isPrimary: true });
            setEmails(prev => prev.map(e => ({ ...e, isPrimary: e.id === emailId })));
        } catch (e) {
            toast.error(extractApiError(e, "Failed to set primary email"));
        }
    };

    return (
        <div className="space-y-6">
            {/* ── Basic fields ── */}
            <div className="space-y-3">
                <div className="space-y-1.5">
                    <Label htmlFor="ce-name">Company Name</Label>
                    <Input id="ce-name" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="ce-reg">Company Reg</Label>
                        <Input id="ce-reg" value={companyReg} onChange={e => setCompanyReg(e.target.value)} placeholder="Registration no." />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="ce-tax">Tax ID / VAT</Label>
                        <Input id="ce-tax" value={taxId} onChange={e => setTaxId(e.target.value)} placeholder="GST / VAT / Tax ID" />
                    </div>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="ce-address">Address</Label>
                    <Input id="ce-address" value={address} onChange={e => setAddress(e.target.value)} placeholder="Address" />
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
                        <span className="flex-1 font-medium">{p.value}</span>
                        {p.isPrimary ? (
                            <span className="shrink-0 text-[10px] text-primary">Primary</span>
                        ) : (
                            phones.length > 1 && (
                                <button
                                    type="button"
                                    onClick={() => void makePhonePrimary(p.id)}
                                    className="shrink-0 text-[10px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                                >
                                    Make primary
                                </button>
                            )
                        )}
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
                        <span className="flex-1">{em.value}</span>
                        {em.isPrimary ? (
                            <span className="shrink-0 text-[10px] text-primary">Primary</span>
                        ) : (
                            emails.length > 1 && (
                                <button
                                    type="button"
                                    onClick={() => void makeEmailPrimary(em.id)}
                                    className="shrink-0 text-[10px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                                >
                                    Make primary
                                </button>
                            )
                        )}
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
