"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, Check, Building2, MapPin, Phone, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { branchAddressSummary } from "@/shared/lib/org/formatBranchAddress";

interface Branch {
    id:           string;
    number:       number;
    name:         string;
    address:      string | null; // legacy summary
    phone:        string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city:         string | null;
    state:        string | null;
    pinCode:      string | null;
    country:      string | null;
    email:        string | null;
    gstin:        string | null;
    gstStateCode: string | null;
    isActive:     boolean;
    createdAt:    string;
    _count: { users: number; departments: number };
}

interface FormState {
    id:           string;
    number:       number | "";
    name:         string;
    address:      string;
    phone:        string;
    addressLine1: string;
    addressLine2: string;
    city:         string;
    state:        string;
    pinCode:      string;
    country:      string;
    email:        string;
    gstin:        string;
    gstStateCode: string;
    isActive:     boolean;
}

const EMPTY: FormState = {
    id: "", number: "", name: "", address: "", phone: "",
    addressLine1: "", addressLine2: "", city: "", state: "",
    pinCode: "", country: "India",
    email: "", gstin: "", gstStateCode: "",
    isActive: true,
};

function fromBranch(b: Branch): FormState {
    return {
        id:           b.id,
        number:       b.number,
        name:         b.name,
        address:      b.address      ?? "",
        phone:        b.phone        ?? "",
        addressLine1: b.addressLine1 ?? "",
        addressLine2: b.addressLine2 ?? "",
        city:         b.city         ?? "",
        state:        b.state        ?? "",
        pinCode:      b.pinCode      ?? "",
        country:      b.country      ?? "India",
        email:        b.email        ?? "",
        gstin:        b.gstin        ?? "",
        gstStateCode: b.gstStateCode ?? "",
        isActive:     b.isActive,
    };
}

export default function BranchesPage() {
    const [branches, setBranches]   = useState<Branch[]>([]);
    const [loading, setLoading]     = useState(true);
    const [addingNew, setAddingNew] = useState(false);
    const [editId, setEditId]       = useState<string | null>(null);
    const [form, setForm]           = useState<FormState>(EMPTY);
    const [saving, setSaving]       = useState(false);

    const loadBranches = async () => {
        try {
            const res = await axios.get<Branch[]>("/api/branches");
            setBranches(res.data);
        } catch { toast.error("Failed to load branches"); }
        finally { setLoading(false); }
    };

    useEffect(() => { loadBranches(); }, []);

    const startAdd = () => {
        const nextNum = branches.length > 0 ? Math.max(...branches.map(b => b.number || 0)) + 1 : 1;
        setForm({ ...EMPTY, number: nextNum });
        setEditId(null);
        setAddingNew(true);
    };
    const startEdit = (b: Branch) => { setForm(fromBranch(b)); setEditId(b.id); setAddingNew(false); };
    const cancel    = () => { setAddingNew(false); setEditId(null); };

    function set<K extends keyof FormState>(field: K, value: FormState[K]) {
        setForm((prev) => {
            const next = { ...prev, [field]: value };
            // GSTIN → first 2 chars → state code. Mirrors the API auto-derive.
            if (field === "gstin" && typeof value === "string") {
                next.gstStateCode = value.length >= 2 ? value.slice(0, 2) : "";
            }
            return next;
        });
    }

    const handleSave = async () => {
        if (!form.name.trim()) { toast.error("Name is required"); return; }
        if (addingNew && !form.id.trim()) { toast.error("ID is required"); return; }
        const num = typeof form.number === "string" ? parseInt(form.number, 10) : form.number;
        if (!num || isNaN(num) || num <= 0) {
            toast.error("Branch number must be an integer greater than 0");
            return;
        }
        setSaving(true);
        try {
            // Send nullable empties as null so the column stays clean (avoids
            // empty strings vs nulls drift in the DB).
            const body: Record<string, unknown> = {
                number:       num,
                name:         form.name,
                address:      form.address || null,
                phone:        form.phone || null,
                addressLine1: form.addressLine1 || null,
                addressLine2: form.addressLine2 || null,
                city:         form.city || null,
                state:        form.state || null,
                pinCode:      form.pinCode || null,
                country:      form.country || null,
                email:        form.email || null,
                gstin:        form.gstin || null,
                gstStateCode: form.gstStateCode || null,
                isActive:     form.isActive,
            };
            if (addingNew) {
                body.id = form.id.toUpperCase();
                await axios.post("/api/branches", body);
                toast.success("Branch created");
            } else {
                if (form.id.trim().toUpperCase() !== editId) body.id = form.id.trim().toUpperCase();
                await axios.patch(`/api/branches/${editId}`, body);
                toast.success("Branch updated");
            }
            cancel();
            loadBranches();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to save branch");
        } finally { setSaving(false); }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this branch?")) return;
        try {
            await axios.delete(`/api/branches/${id}`);
            toast.success("Branch deleted");
            loadBranches();
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to delete branch");
        }
    };

    const handleToggleActive = async (b: Branch) => {
        try {
            await axios.patch(`/api/branches/${b.id}`, { isActive: !b.isActive });
            toast.success(b.isActive ? "Branch deactivated" : "Branch activated");
            loadBranches();
        } catch { toast.error("Failed to update branch"); }
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <Building2 size={28} /> Branches
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Physical and virtual locations of your organisation. Each branch has its own address and GSTIN
                        (required by Indian GST law when branches are in different states); other identity (brand, logo,
                        website, PAN) is code-owned config in{" "}
                        <code className="rounded bg-muted px-1 py-0.5 text-xs">src/shared/lib/constants/companyDetails.ts</code>.
                    </p>
                </div>
                <Button onClick={startAdd} disabled={addingNew}>
                    <Plus size={16} /> New Branch
                </Button>
            </div>

            {/* New branch inline form */}
            {addingNew && (
                <BranchForm
                    form={form}
                    set={set}
                    onSave={handleSave}
                    onCancel={cancel}
                    saving={saving}
                    title="New Branch"
                    isCreate
                />
            )}

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
                <div className="space-y-2">
                    {branches.length === 0 && !addingNew && (
                        <p className="border-dashed text-sm text-muted-foreground py-8 text-center border border-border">No branches yet. Create one above.</p>
                    )}
                    {branches.map(b => (
                        <div key={b.id} className={`rounded-lg border border-border border-l-4 ${b.isActive ? "border-l-primary" : "border-l-muted-foreground opacity-60"} bg-card`}>
                            {editId === b.id ? (
                                <BranchForm
                                    form={form}
                                    set={set}
                                    onSave={handleSave}
                                    onCancel={cancel}
                                    saving={saving}
                                    title={`Edit ${b.name}`}
                                    renameWarning={form.id.trim().toUpperCase() !== editId && form.id.trim() !== ""}
                                />
                            ) : (
                                <div className="flex items-center gap-4 px-4 py-3">
                                    <div className="shrink-0 flex items-center gap-1.5">
                                        <Badge variant="outline" className="font-mono text-xs font-semibold">#{b.number}</Badge>
                                        <Badge className="font-mono text-xs">{b.id}</Badge>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-sm">{b.name}</p>
                                        <div className="flex gap-3 mt-0.5 flex-wrap">
                                            {branchAddressSummary(b) && (
                                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                    <MapPin size={10} />{branchAddressSummary(b)}
                                                </span>
                                            )}
                                            {b.phone && (
                                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                    <Phone size={10} />{b.phone}
                                                </span>
                                            )}
                                            {b.gstin && (
                                                <span className="text-xs text-muted-foreground font-mono">
                                                    GSTIN: {b.gstin}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className="text-xs text-muted-foreground">{b._count.users} users · {b._count.departments} depts</span>
                                        <Badge className={b.isActive ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}>
                                            {b.isActive ? "Active" : "Inactive"}
                                        </Badge>
                                        <div className="flex gap-1">
                                            <Button variant="outline" size="icon-sm" title={b.isActive ? "Deactivate" : "Activate"} onClick={() => handleToggleActive(b)}>
                                                {b.isActive ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                                            </Button>
                                            <Button variant="outline" size="icon-sm" onClick={() => startEdit(b)}><Pencil size={14} /></Button>
                                            <Button variant="destructive" size="icon-sm" onClick={() => handleDelete(b.id)}><Trash2 size={14} /></Button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
            </div>
        </ScrollArea>
    );
}

interface BranchFormProps {
    form:          FormState;
    set:           <K extends keyof FormState>(field: K, value: FormState[K]) => void;
    onSave:        () => void;
    onCancel:      () => void;
    saving:        boolean;
    title:         string;
    isCreate?:     boolean;
    renameWarning?: boolean;
}

function BranchForm({ form, set, onSave, onCancel, saving, title, isCreate, renameWarning }: BranchFormProps) {
    return (
        <div className={`space-y-4 ${isCreate ? "rounded-lg border border-primary bg-muted/30 p-4" : "p-4"}`}>
            <p className="text-sm font-semibold">{title}</p>

            {/* Identity */}
            <section className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">Identity</p>
                <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-3">
                        <Field label="Number *" hint="Unique positive integer (e.g. 1, 2)">
                            <Input
                                type="number"
                                min={1}
                                step={1}
                                value={form.number}
                                onChange={(e) => set("number", e.target.value === "" ? "" : parseInt(e.target.value, 10) || "")}
                                className="font-mono"
                                placeholder="1"
                            />
                        </Field>
                    </div>
                    <div className="col-span-4">
                        <Field label={`ID${isCreate ? " *" : ""}`} hint={isCreate ? "e.g. BR-HQ, BR-NYC" : undefined}>
                            <Input
                                value={form.id}
                                onChange={(e) => set("id", e.target.value.toUpperCase())}
                                className="font-mono uppercase"
                            />
                            {renameWarning && (
                                <p className="text-[10px] text-amber-600 mt-0.5">
                                    Renaming ID — all linked departments, positions and inventory will cascade automatically.
                                </p>
                            )}
                        </Field>
                    </div>
                    <div className="col-span-5">
                        <Field label="Name *">
                            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
                        </Field>
                    </div>
                </div>
            </section>

            {/* Address */}
            <section className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">Address</p>
                <Field label="Address line 1">
                    <Input value={form.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} />
                </Field>
                <Field label="Address line 2">
                    <Input value={form.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                    <Field label="City">
                        <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
                    </Field>
                    <Field label="State">
                        <Input value={form.state} onChange={(e) => set("state", e.target.value)} />
                    </Field>
                    <Field label="PIN code">
                        <Input inputMode="numeric" value={form.pinCode} onChange={(e) => set("pinCode", e.target.value)} />
                    </Field>
                </div>
                <Field label="Country">
                    <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
                </Field>
            </section>

            {/* Tax */}
            <section className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">Tax</p>
                <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                        <Field label="GSTIN" hint="15 chars. Branches in different GST states need their own.">
                            <Input
                                value={form.gstin}
                                onChange={(e) => set("gstin", e.target.value.toUpperCase().slice(0, 15))}
                                className="font-mono"
                                placeholder="00ABCDE1234F1Z5"
                            />
                        </Field>
                    </div>
                    <Field label="State code" hint="Auto from GSTIN">
                        <Input value={form.gstStateCode} readOnly className="bg-muted/40 font-mono" />
                    </Field>
                </div>
            </section>

            {/* Contact */}
            <section className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">Contact</p>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Phone">
                        <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                    </Field>
                    <Field label="Email">
                        <Input value={form.email} onChange={(e) => set("email", e.target.value)} />
                    </Field>
                </div>
                <Field
                    label="Legacy single-line address"
                    hint="Optional shorthand shown on old list rows. Leave blank if you've filled in the structured fields above."
                >
                    <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
                </Field>
            </section>

            <div className="flex gap-2 pt-1">
                <Button onClick={onSave} disabled={saving} size="sm"><Check size={14} /> Save</Button>
                <Button variant="outline" size="sm" onClick={onCancel}><X size={14} /> Cancel</Button>
            </div>
        </div>
    );
}

function Field({
    label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
            {children}
            {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
        </div>
    );
}
