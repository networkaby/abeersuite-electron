"use client";

import { useMemo, useState } from "react";
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
import { extractApiError } from "@/shared/lib/api";
import { parseDecimalInput, parseDigitsInput, toDateInput } from "@/shared/lib/format";

export interface NamedOpt { id: number; name: string }
export interface ProductOpt { id: number; sku: string; name: string }

/// The inventory masters the item-rule pickers choose from.
export interface RuleMasters {
    categories: NamedOpt[];
    products: ProductOpt[];
    groups: NamedOpt[];
    brands: NamedOpt[];
}

/// One item rule. The fields that are set are ANDed by the engine (brand + category
/// = that brand's items in that category); separate rules are ORed.
export interface CouponRule {
    kind: "INCLUDE" | "EXCLUDE";
    productId: number | null;
    categoryId: number | null;
    groupId: number | null;
    brandId: number | null;
}

export interface Coupon {
    id: number;
    code: string | null;
    name: string;
    description: string | null;
    type: "PERCENT" | "FLAT" | "FREE_ITEM" | "BOGO" | "SET_PRICE";
    channels: "POS" | "SHOP" | "BOTH";
    applyMode: "CODE" | "AUTO";
    percentOff: string | number | null;
    maxDiscountAmt: string | number | null;
    flatAmt: string | number | null;
    freeProductId: number | null;
    freeQty: string | number | null;
    freeDiscountPct: string | number | null;
    buyProductId: number | null;
    buyQty: string | number | null;
    getQty: string | number | null;
    setPriceAmt: string | number | null;
    rules?: CouponRule[];
    startsAt: string | null;
    endsAt: string | null;
    minBillValue: string | number | null;
    totalUsageLimit: number | null;
    perCustomerLimit: number | null;
    singleUse: boolean;
    eligibility: "ANY" | "NEW" | "RETURNING";
    stackable: boolean;
    stackScope: "BILL" | "LINE";
    isActive: boolean;
    _count?: { redemptions: number };
}

const str = (v: string | number | null | undefined): string => (v == null ? "" : String(v));
const optNum = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const optInt = (s: string): number | null => (s.trim() === "" ? null : parseInt(s, 10));
// <input type="date"> needs YYYY-MM-DD; the API stores a full timestamp.
const fromDateInput = (d: string): string | null => (d.trim() === "" ? null : new Date(d + "T00:00:00").toISOString());

interface Props {
    initial?: Coupon;
    masters: RuleMasters;
    onSaved: () => void;
    onCancel: () => void;
    /// When rendered inside a dialog: drop the dashed card chrome + internal header.
    embedded?: boolean;
}

/// Shared by every product picker on the form (offer item, buy/get, rules).
const productOptions = (products: ProductOpt[]) =>
    products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}`, leaf: p.name }));

export function CouponForm({ initial, masters, onSaved, onCancel, embedded }: Props) {
    const { products } = masters;
    const prodOpts = useMemo(() => productOptions(products), [products]);
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
    const [buyProductId, setBuyProductId] = useState<number | null>(initial?.buyProductId ?? null);
    const [buyQty, setBuyQty] = useState(str(initial?.buyQty ?? (initial ? null : "1")));
    const [getQty, setGetQty] = useState(str(initial?.getQty ?? (initial ? null : "1")));
    const [setPriceAmt, setSetPriceAmt] = useState(str(initial?.setPriceAmt));
    const [rules, setRules] = useState<CouponRule[]>(initial?.rules ?? []);
    const [startsAt, setStartsAt] = useState(toDateInput(initial?.startsAt ?? null));
    const [endsAt, setEndsAt] = useState(toDateInput(initial?.endsAt ?? null));
    const [minBillValue, setMinBillValue] = useState(str(initial?.minBillValue));
    const [totalUsageLimit, setTotalUsageLimit] = useState(str(initial?.totalUsageLimit));
    const [perCustomerLimit, setPerCustomerLimit] = useState(str(initial?.perCustomerLimit));
    const [singleUse, setSingleUse] = useState(initial?.singleUse ?? false);
    const [eligibility, setEligibility] = useState<Coupon["eligibility"]>(initial?.eligibility ?? "ANY");
    const [stackable, setStackable] = useState(initial?.stackable ?? false);
    const [stackScope, setStackScope] = useState<Coupon["stackScope"]>(initial?.stackScope ?? (initial?.type === "SET_PRICE" ? "LINE" : "BILL"));
    const [saving, setSaving] = useState(false);

    async function save() {
        if (!name.trim()) return toast.error("Name the coupon");
        if (applyMode === "CODE" && !code.trim()) return toast.error("Code-entry coupons need a code");
        if (type === "PERCENT" && optNum(percentOff) == null) return toast.error("Enter a % off");
        if (type === "FLAT" && optNum(flatAmt) == null) return toast.error("Enter a flat ₹ amount");
        if (type === "FREE_ITEM" && freeProductId == null) return toast.error("Pick the offer item");
        if (type === "BOGO" && freeProductId == null && buyProductId == null) return toast.error("Pick the buy and/or get item");
        if (type === "SET_PRICE" && optNum(setPriceAmt) == null) return toast.error("Enter the set ₹ price");

        const payload = {
            code: applyMode === "AUTO" ? null : code.trim().toUpperCase(),
            name: name.trim(),
            description: description.trim() || null,
            type, channels, applyMode,
            percentOff: type === "PERCENT" ? optNum(percentOff) : null,
            maxDiscountAmt: type === "PERCENT" ? optNum(maxDiscountAmt) : null,
            flatAmt: type === "FLAT" ? optNum(flatAmt) : null,
            freeProductId: type === "FREE_ITEM" || type === "BOGO" ? freeProductId : null,
            freeQty: type === "FREE_ITEM" ? optNum(freeQty) : null,
            freeDiscountPct: type === "FREE_ITEM" || type === "BOGO" ? optNum(freeDiscountPct) : null,
            buyProductId: type === "BOGO" ? buyProductId : null,
            buyQty: type === "BOGO" ? optNum(buyQty) : null,
            getQty: type === "BOGO" ? optNum(getQty) : null,
            setPriceAmt: type === "SET_PRICE" ? optNum(setPriceAmt) : null,
            rules: rules.filter((r) => r.productId != null || r.categoryId != null),
            startsAt: fromDateInput(startsAt),
            endsAt: fromDateInput(endsAt),
            minBillValue: optNum(minBillValue),
            totalUsageLimit: optInt(totalUsageLimit),
            perCustomerLimit: optInt(perCustomerLimit),
            singleUse, eligibility, stackable,
            stackScope: stackable ? "BILL" as const : stackScope,
        };

        setSaving(true);
        try {
            if (editing) await axios.patch(`/api/coupons/${initial!.id}`, payload);
            else await axios.post("/api/coupons", payload);
            toast.success(editing ? "Coupon updated" : "Coupon created");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Save failed"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className={embedded ? "space-y-4" : "space-y-4 rounded-lg border border-dashed border-border/70 bg-muted/20 p-4"}>
            {!embedded && (
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{editing ? `Edit ${initial!.code ?? initial!.name}` : "New coupon"}</span>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCancel}><X size={14} /></Button>
                </div>
            )}

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
                            <SelectItem value="BOGO">Buy X get Y</SelectItem>
                            <SelectItem value="SET_PRICE">Set price (clearance)</SelectItem>
                        </SelectContent>
                    </Select>
                </Field>
                {type === "PERCENT" && (
                    <>
                        <Field label="% off">
                            <Input inputMode="decimal" value={percentOff} onChange={(e) => setPercentOff(parseDecimalInput(e.target.value))} placeholder="20" className="h-9 text-right" />
                        </Field>
                        <Field label="Max ₹ cap (optional)">
                            <RupeeInput value={maxDiscountAmt} onChange={(v) => setMaxDiscountAmt(parseDecimalInput(v))} placeholder="500" />
                        </Field>
                    </>
                )}
                {type === "FLAT" && (
                    <Field label="Flat ₹ off">
                        <RupeeInput value={flatAmt} onChange={(v) => setFlatAmt(parseDecimalInput(v))} placeholder="200" />
                    </Field>
                )}
                {type === "SET_PRICE" && (
                    <Field label="Set ₹ price (per unit)">
                        <RupeeInput value={setPriceAmt} onChange={(v) => setSetPriceAmt(parseDecimalInput(v))} placeholder="80" />
                    </Field>
                )}
                {type === "FREE_ITEM" && (
                    <>
                        <Field label="Offer item (must be in cart)">
                            <SearchableSelect<number>
                                value={freeProductId}
                                options={prodOpts}
                                onChange={setFreeProductId}
                                placeholder="— pick item —"
                                triggerClassName="h-9"
                            />
                        </Field>
                        <Field label="Free qty">
                            <Input inputMode="decimal" value={freeQty} onChange={(e) => setFreeQty(parseDecimalInput(e.target.value))} placeholder="1" className="h-9 text-right" />
                        </Field>
                        <Field label="Discount % on it (100 = free)">
                            <Input inputMode="decimal" value={freeDiscountPct} onChange={(e) => setFreeDiscountPct(parseDecimalInput(e.target.value))} placeholder="100" className="h-9 text-right" />
                        </Field>
                    </>
                )}
                {type === "BOGO" && (
                    <>
                        <Field label="Buy item (blank = any)">
                            <SearchableSelect<number>
                                value={buyProductId}
                                options={prodOpts}
                                onChange={setBuyProductId}
                                placeholder="— any item —"
                                triggerClassName="h-9"
                            />
                        </Field>
                        <Field label="Buy qty (X)">
                            <Input inputMode="decimal" value={buyQty} onChange={(e) => setBuyQty(parseDecimalInput(e.target.value))} placeholder="1" className="h-9 text-right" />
                        </Field>
                        <Field label="Get qty (Y)">
                            <Input inputMode="decimal" value={getQty} onChange={(e) => setGetQty(parseDecimalInput(e.target.value))} placeholder="1" className="h-9 text-right" />
                        </Field>
                        <Field label="Get item (blank = same as buy)">
                            <SearchableSelect<number>
                                value={freeProductId}
                                options={prodOpts}
                                onChange={setFreeProductId}
                                placeholder="— same item —"
                                triggerClassName="h-9"
                            />
                        </Field>
                        <Field label="Discount % on get (100 = free)">
                            <Input inputMode="decimal" value={freeDiscountPct} onChange={(e) => setFreeDiscountPct(parseDecimalInput(e.target.value))} placeholder="100" className="h-9 text-right" />
                        </Field>
                    </>
                )}
            </div>

            {/* Item rules (optional) — limit the coupon to / exclude items by product, category, group or brand */}
            <RuleEditor rules={rules} setRules={setRules} masters={masters} prodOpts={prodOpts} />
            {type === "SET_PRICE" && rules.length === 0 && (
                <p className="-mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                    No item rule set — this will mark down EVERY product to the same ₹ price. Add a product/category/group/brand rule to target the clearance stock.
                </p>
            )}

            {/* Constraints */}
            <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Valid from">
                    <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="h-9" />
                </Field>
                <Field label="Valid until">
                    <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="h-9" />
                </Field>
                <Field label="Min bill ₹ (optional)">
                    <RupeeInput value={minBillValue} onChange={(v) => setMinBillValue(parseDecimalInput(v))} placeholder="1000" />
                </Field>
                <Field label="Total uses (optional)">
                    <Input inputMode="numeric" value={totalUsageLimit} onChange={(e) => setTotalUsageLimit(parseDigitsInput(e.target.value))} placeholder="∞" className="h-9 text-right" />
                </Field>
                <Field label="Per-customer uses (optional)">
                    <Input inputMode="numeric" value={perCustomerLimit} onChange={(e) => setPerCustomerLimit(parseDigitsInput(e.target.value))} placeholder="∞" className="h-9 text-right" />
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
            <div className="flex flex-wrap items-center gap-5">
                <Toggle label="Single-use code" hint="One redemption total" checked={singleUse} onChange={setSingleUse} />
                <Toggle label="Stackable" hint="Combine with tier + loyalty" checked={stackable} onChange={setStackable} />
                {!stackable && (
                    <Field label="When exclusive, blocks tier + loyalty on…">
                        <Select value={stackScope} onValueChange={(v) => setStackScope(v as Coupon["stackScope"])}>
                            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="BILL">The whole bill</SelectItem>
                                <SelectItem value="LINE">Only this coupon&rsquo;s own items</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                )}
            </div>

            <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
                <Button size="sm" onClick={save} disabled={saving}><Save size={14} className="mr-1" /> {editing ? "Save" : "Create"}</Button>
            </div>
        </div>
    );
}

const EMPTY_RULE: CouponRule = { kind: "INCLUDE", productId: null, categoryId: null, groupId: null, brandId: null };

/// The rule fields that are ANDed. Order = how the chip reads.
const RULE_FIELDS = ["productId", "categoryId", "groupId", "brandId"] as const;
type RuleField = (typeof RULE_FIELDS)[number];

const ruleIsEmpty = (r: CouponRule) => RULE_FIELDS.every((f) => r[f] == null);

/// Compose a rule across the four pickers, then "Add rule" commits it as one chip.
/// Anything left blank is simply absent from the AND.
function RuleEditor({ rules, setRules, masters, prodOpts }: {
    rules: CouponRule[];
    setRules: (r: CouponRule[]) => void;
    masters: RuleMasters;
    prodOpts: { value: number; label: string; leaf?: string }[];
}) {
    const { categories, products, groups, brands } = masters;
    const [draft, setDraft] = useState<CouponRule>(EMPTY_RULE);

    const named = (list: NamedOpt[], id: number, fallback: string) => list.find((x) => x.id === id)?.name ?? `${fallback} #${id}`;
    const labelFor = (r: CouponRule, f: RuleField): string => {
        const id = r[f]!;
        switch (f) {
            case "productId": { const p = products.find((x) => x.id === id); return p ? `${p.sku} — ${p.name}` : `#${id}`; }
            case "categoryId": return named(categories, id, "cat");
            case "groupId": return named(groups, id, "group");
            case "brandId": return named(brands, id, "brand");
        }
    };
    /// "Samsung + Phones" — the AND of every field set on the rule.
    const ruleLabel = (r: CouponRule) => RULE_FIELDS.filter((f) => r[f] != null).map((f) => labelFor(r, f)).join(" + ");

    const addDraft = () => { setRules([...rules, draft]); setDraft({ ...EMPTY_RULE, kind: draft.kind }); };

    const pickers: { field: RuleField; placeholder: string; width: string; options: { value: number; label: string; leaf?: string }[] }[] = [
        { field: "productId",  placeholder: "+ product",  width: "w-48", options: prodOpts },
        { field: "categoryId", placeholder: "+ category", width: "w-44", options: categories.map((c) => ({ value: c.id, label: c.name })) },
        { field: "groupId",    placeholder: "+ group",    width: "w-44", options: groups.map((g) => ({ value: g.id, label: g.name })) },
        { field: "brandId",    placeholder: "+ brand",    width: "w-40", options: brands.map((b) => ({ value: b.id, label: b.name })) },
    ];

    return (
        <div className="space-y-2 rounded-md border border-border/60 p-3">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">Item rules (optional)</span>
                <span className="text-[10px] text-muted-foreground">no rules = applies to the whole bill</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as CouponRule["kind"] })}>
                    <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="INCLUDE">Only on</SelectItem>
                        <SelectItem value="EXCLUDE">Exclude</SelectItem>
                    </SelectContent>
                </Select>
                {pickers.map((p) => (
                    <div key={p.field} className={p.width}>
                        <SearchableSelect<number>
                            value={draft[p.field]}
                            options={p.options}
                            onChange={(v) => setDraft({ ...draft, [p.field]: v })}
                            placeholder={p.placeholder}
                            triggerClassName="h-8 text-xs"
                        />
                    </div>
                ))}
                <Button size="sm" variant="secondary" className="h-8 text-xs" disabled={ruleIsEmpty(draft)} onClick={addDraft}>
                    Add rule
                </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
                Fields set on one rule must ALL match — brand + category = that brand&rsquo;s items in that category. Separate rules match independently.
            </p>
            {rules.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {rules.map((r, i) => (
                        <span key={i} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${r.kind === "INCLUDE" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"}`}>
                            {r.kind === "INCLUDE" ? "only" : "excl"} · {ruleLabel(r)}
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
