"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/shared/components/SearchableSelect";

export interface CategoryOpt { id: number; name: string }
export interface ProductOpt { id: number; sku: string; name: string }
export interface CouponRule { kind: "INCLUDE" | "EXCLUDE"; productId: number | null; categoryId: number | null }

export interface Coupon {
    id: number;
    code: string | null;
    name: string;
    description: string | null;
    type: "PERCENT" | "FLAT" | "FREE_ITEM" | "BOGO";
    channels: "POS" | "SHOP" | "BOTH";
    applyMode: "CODE" | "AUTO";
    percentOff: string | number | null;
    maxDiscountAmt: string | number | null;
    flatAmt: string | number | null;
    freeProductId: number | null;
    freeQty: string | number | null;
    freeDiscountPct: string | number | null;
    rules?: CouponRule[];
    startsAt: string | null;
    endsAt: string | null;
    minBillValue: string | number | null;
    totalUsageLimit: number | null;
    perCustomerLimit: number | null;
    singleUse: boolean;
    eligibility: "ANY" | "NEW" | "RETURNING";
    stackable: boolean;
    isActive: boolean;
    _count?: { redemptions: number };
}

const dec = (s: string): string => s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
const int = (s: string): string => s.replace(/\D/g, "");
const str = (v: string | number | null | undefined): string => (v == null ? "" : String(v));
const optNum = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const optInt = (s: string): number | null => (s.trim() === "" ? null : parseInt(s, 10));
// <input type="date"> needs YYYY-MM-DD; the API stores a full timestamp.
const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");
const fromDateInput = (d: string): string | null => (d.trim() === "" ? null : new Date(d + "T00:00:00").toISOString());

interface Props {
    initial?: Coupon;
    categories: CategoryOpt[];
    products: ProductOpt[];
    onSaved: () => void;
    onCancel: () => void;
}

export function CouponForm({ initial, categories, products, onSaved, onCancel }: Props) {
    const editing = !!initial;
    const [code, setCode] = useState(str(initial?.code));
    const [name, setName] = useState(initial?.name ?? "");
    const [description, setDescription] = useState(str(initial?.description));
    const [type, setType] = useState<Coupon["type"]>(initial?.type ?? "PERCENT");
    const [channels, setChannels] = useState<Coupon["channels"]>(initial?.channels ?? "BOTH");
    const [applyMode, setApplyMode] = useState<Coupon["applyMode"]>(initial?.applyMode ?? "CODE");
    const [percentOff, setPercentOff] = useState(str(initial?.percentOff));
    const [maxDiscountAmt, setMaxDiscountAmt] = useState(str(initial?.maxDiscountAmt));
    const [flatAmt, setFlatAmt] = useState(str(initial?.flatAmt));
    const [freeProductId, setFreeProductId] = useState<number | null>(initial?.freeProductId ?? null);
    const [freeQty, setFreeQty] = useState(str(initial?.freeQty ?? (initial ? null : "1")));
    const [freeDiscountPct, setFreeDiscountPct] = useState(str(initial?.freeDiscountPct ?? (initial ? null : "100")));
    const [rules, setRules] = useState<CouponRule[]>(initial?.rules ?? []);
    const [startsAt, setStartsAt] = useState(toDateInput(initial?.startsAt ?? null));
    const [endsAt, setEndsAt] = useState(toDateInput(initial?.endsAt ?? null));
    const [minBillValue, setMinBillValue] = useState(str(initial?.minBillValue));
    const [totalUsageLimit, setTotalUsageLimit] = useState(str(initial?.totalUsageLimit));
    const [perCustomerLimit, setPerCustomerLimit] = useState(str(initial?.perCustomerLimit));
    const [singleUse, setSingleUse] = useState(initial?.singleUse ?? false);
    const [eligibility, setEligibility] = useState<Coupon["eligibility"]>(initial?.eligibility ?? "ANY");
    const [stackable, setStackable] = useState(initial?.stackable ?? false);
    const [saving, setSaving] = useState(false);

    async function save() {
        if (!name.trim()) return toast.error("Name the coupon");
        if (applyMode === "CODE" && !code.trim()) return toast.error("Code-entry coupons need a code");
        if (type === "PERCENT" && optNum(percentOff) == null) return toast.error("Enter a % off");
        if (type === "FLAT" && optNum(flatAmt) == null) return toast.error("Enter a flat ₹ amount");
        if (type === "FREE_ITEM" && freeProductId == null) return toast.error("Pick the offer item");

        const payload = {
            code: applyMode === "AUTO" ? null : code.trim().toUpperCase(),
            name: name.trim(),
            description: description.trim() || null,
            type, channels, applyMode,
            percentOff: type === "PERCENT" ? optNum(percentOff) : null,
            maxDiscountAmt: type === "PERCENT" ? optNum(maxDiscountAmt) : null,
            flatAmt: type === "FLAT" ? optNum(flatAmt) : null,
            freeProductId: type === "FREE_ITEM" ? freeProductId : null,
            freeQty: type === "FREE_ITEM" ? optNum(freeQty) : null,
            freeDiscountPct: type === "FREE_ITEM" ? optNum(freeDiscountPct) : null,
            rules: rules.filter((r) => r.productId != null || r.categoryId != null),
            startsAt: fromDateInput(startsAt),
            endsAt: fromDateInput(endsAt),
            minBillValue: optNum(minBillValue),
            totalUsageLimit: optInt(totalUsageLimit),
            perCustomerLimit: optInt(perCustomerLimit),
            singleUse, eligibility, stackable,
        };

        setSaving(true);
        try {
            if (editing) await axios.patch(`/api/coupons/${initial!.id}`, payload);
            else await axios.post("/api/coupons", payload);
            toast.success(editing ? "Coupon updated" : "Coupon created");
            onSaved();
        } catch (e) {
            const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? "Save failed") : "Save failed";
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="space-y-4 rounded-lg border border-dashed border-border/70 bg-muted/20 p-4">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{editing ? `Edit ${initial!.code ?? initial!.name}` : "New coupon"}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCancel}><X size={14} /></Button>
            </div>

            {/* Identity */}
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Apply mode">
                    <Select value={applyMode} onValueChange={(v) => setApplyMode(v as Coupon["applyMode"])}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="CODE">Code entry</SelectItem>
                            <SelectItem value="AUTO">Auto-apply (no code)</SelectItem>
                        </SelectContent>
                    </Select>
                </Field>
                {applyMode === "CODE" && (
                    <Field label="Code">
                        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DIWALI20" className="h-9 font-mono" />
                    </Field>
                )}
                <Field label="Name">
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali 20% off" className="h-9" />
                </Field>
                <Field label="Channel">
                    <Select value={channels} onValueChange={(v) => setChannels(v as Coupon["channels"])}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="BOTH">POS + Online shop</SelectItem>
                            <SelectItem value="POS">POS only</SelectItem>
                            <SelectItem value="SHOP">Online shop only</SelectItem>
                        </SelectContent>
                    </Select>
                </Field>
            </div>
            <Field label="Description (optional)">
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown to staff" className="min-h-[44px]" />
            </Field>

            {/* Mechanic */}
            <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Type">
                    <Select value={type} onValueChange={(v) => setType(v as Coupon["type"])}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="PERCENT">% off</SelectItem>
                            <SelectItem value="FLAT">Flat ₹ off</SelectItem>
                            <SelectItem value="FREE_ITEM">Free / discounted item</SelectItem>
                            <SelectItem value="BOGO" disabled>Buy X get Y (soon)</SelectItem>
                        </SelectContent>
                    </Select>
                </Field>
                {type === "PERCENT" && (
                    <>
                        <Field label="% off">
                            <Input inputMode="decimal" value={percentOff} onChange={(e) => setPercentOff(dec(e.target.value))} placeholder="20" className="h-9 text-right" />
                        </Field>
                        <Field label="Max ₹ cap (optional)">
                            <RupeeInput value={maxDiscountAmt} onChange={(v) => setMaxDiscountAmt(dec(v))} placeholder="500" />
                        </Field>
                    </>
                )}
                {type === "FLAT" && (
                    <Field label="Flat ₹ off">
                        <RupeeInput value={flatAmt} onChange={(v) => setFlatAmt(dec(v))} placeholder="200" />
                    </Field>
                )}
                {type === "FREE_ITEM" && (
                    <>
                        <Field label="Offer item (must be in cart)">
                            <SearchableSelect<number>
                                value={freeProductId}
                                options={products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}`, leaf: p.name }))}
                                onChange={setFreeProductId}
                                placeholder="— pick item —"
                                triggerClassName="h-9"
                            />
                        </Field>
                        <Field label="Free qty">
                            <Input inputMode="decimal" value={freeQty} onChange={(e) => setFreeQty(dec(e.target.value))} placeholder="1" className="h-9 text-right" />
                        </Field>
                        <Field label="Discount % on it (100 = free)">
                            <Input inputMode="decimal" value={freeDiscountPct} onChange={(e) => setFreeDiscountPct(dec(e.target.value))} placeholder="100" className="h-9 text-right" />
                        </Field>
                    </>
                )}
            </div>

            {/* Item rules (optional) — limit the coupon to / exclude specific products or categories */}
            <RuleEditor rules={rules} setRules={setRules} categories={categories} products={products} />

            {/* Constraints */}
            <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Valid from">
                    <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="h-9" />
                </Field>
                <Field label="Valid until">
                    <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="h-9" />
                </Field>
                <Field label="Min bill ₹ (optional)">
                    <RupeeInput value={minBillValue} onChange={(v) => setMinBillValue(dec(v))} placeholder="1000" />
                </Field>
                <Field label="Total uses (optional)">
                    <Input inputMode="numeric" value={totalUsageLimit} onChange={(e) => setTotalUsageLimit(int(e.target.value))} placeholder="∞" className="h-9 text-right" />
                </Field>
                <Field label="Per-customer uses (optional)">
                    <Input inputMode="numeric" value={perCustomerLimit} onChange={(e) => setPerCustomerLimit(int(e.target.value))} placeholder="∞" className="h-9 text-right" />
                </Field>
                <Field label="Eligibility">
                    <Select value={eligibility} onValueChange={(v) => setEligibility(v as Coupon["eligibility"])}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ANY">Any customer</SelectItem>
                            <SelectItem value="NEW">First-time only</SelectItem>
                            <SelectItem value="RETURNING">Returning only</SelectItem>
                        </SelectContent>
                    </Select>
                </Field>
            </div>

            {/* Toggles */}
            <div className="flex flex-wrap gap-5">
                <Toggle label="Single-use code" hint="One redemption total" checked={singleUse} onChange={setSingleUse} />
                <Toggle label="Stackable" hint="Combine with tier + loyalty" checked={stackable} onChange={setStackable} />
            </div>

            <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
                <Button size="sm" onClick={save} disabled={saving}><Save size={14} className="mr-1" /> {editing ? "Save" : "Create"}</Button>
            </div>
        </div>
    );
}

function RuleEditor({ rules, setRules, categories, products }: {
    rules: CouponRule[];
    setRules: (r: CouponRule[]) => void;
    categories: CategoryOpt[];
    products: ProductOpt[];
}) {
    const [kind, setKind] = useState<"INCLUDE" | "EXCLUDE">("INCLUDE");
    const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? `cat #${id}`;
    const prodName = (id: number) => { const p = products.find((x) => x.id === id); return p ? `${p.sku} — ${p.name}` : `#${id}`; };
    const add = (rule: CouponRule) => setRules([...rules, rule]);
    return (
        <div className="space-y-2 rounded-md border border-border/60 p-3">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">Item rules (optional)</span>
                <span className="text-[10px] text-muted-foreground">no rules = applies to the whole bill</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Select value={kind} onValueChange={(v) => setKind(v as "INCLUDE" | "EXCLUDE")}>
                    <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="INCLUDE">Only on</SelectItem>
                        <SelectItem value="EXCLUDE">Exclude</SelectItem>
                    </SelectContent>
                </Select>
                <div className="w-48">
                    <SearchableSelect<number>
                        value={null}
                        options={products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}`, leaf: p.name }))}
                        onChange={(v) => { if (v != null) add({ kind, productId: v, categoryId: null }); }}
                        placeholder="+ product"
                        clearable={false}
                        triggerClassName="h-8 text-xs"
                    />
                </div>
                <div className="w-44">
                    <SearchableSelect<number>
                        value={null}
                        options={categories.map((c) => ({ value: c.id, label: c.name }))}
                        onChange={(v) => { if (v != null) add({ kind, productId: null, categoryId: v }); }}
                        placeholder="+ category"
                        clearable={false}
                        triggerClassName="h-8 text-xs"
                    />
                </div>
            </div>
            {rules.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {rules.map((r, i) => (
                        <span key={i} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${r.kind === "INCLUDE" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"}`}>
                            {r.kind === "INCLUDE" ? "only" : "excl"} · {r.productId != null ? prodName(r.productId) : catName(r.categoryId!)}
                            <button type="button" onClick={() => setRules(rules.filter((_, j) => j !== i))} className="opacity-70 hover:opacity-100"><X size={11} /></button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">{label}</Label>
            {children}
        </div>
    );
}

function RupeeInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
    return (
        <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
            <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9 pl-6 text-right" />
        </div>
    );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="flex items-center gap-2">
            <Switch checked={checked} onCheckedChange={onChange} />
            <span className="text-sm">
                {label} <span className="text-xs text-muted-foreground">· {hint}</span>
            </span>
        </label>
    );
}
