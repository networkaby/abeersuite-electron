"use client";

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Dices, Gift, IndianRupee, Percent, Repeat, Save, Sparkles, Tag, X, type LucideIcon } from "lucide-react";
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
    /// FREE_ITEM / BOGO only — independent FREE-GRANT coupon: applies on top of
    /// the money coupon and grants the item(s) as zero-price FREE lines.
    independent?: boolean;
    isActive: boolean;
    _count?: { redemptions: number };
}

const str = (v: string | number | null | undefined): string => (v == null ? "" : String(v));
const optNum = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const optInt = (s: string): number | null => (s.trim() === "" ? null : parseInt(s, 10));
// <input type="date"> needs YYYY-MM-DD; the API stores a full timestamp.
const fromDateInput = (d: string): string | null => (d.trim() === "" ? null : new Date(d + "T00:00:00").toISOString());

const CHANNEL_LABEL: Record<Coupon["channels"], string> = { BOTH: "POS + Shop", POS: "POS only", SHOP: "Shop only" };

/// A readable, overridable code derived from the name — e.g. "MONSOON1234".
/// The server still enforces uniqueness; a clash surfaces as a save error.
function generateCode(name: string): string {
    const base = (name.replace(/[^a-z0-9]/gi, "") || "COUPON").slice(0, 6).toUpperCase();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${base}${rand}`;
}

/// Coupon type as a segmented picker — the single most important choice, so it
/// gets visual buttons instead of a dropdown.
const TYPE_OPTIONS: { value: Coupon["type"]; label: string; icon: LucideIcon }[] = [
    { value: "PERCENT",   label: "% off",          icon: Percent },
    { value: "FLAT",      label: "Flat ₹",         icon: IndianRupee },
    { value: "FREE_ITEM", label: "Free item",      icon: Gift },
    { value: "BOGO",      label: "Buy X get Y",    icon: Repeat },
    { value: "SET_PRICE", label: "Set price",      icon: Tag },
];

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
    /// Auto-apply is just a toggle now — every coupon carries a code (auto-
    /// generated, manually overridable); the toggle decides whether it also
    /// applies automatically at checkout.
    const [autoApply, setAutoApply] = useState(initial?.applyMode === "AUTO");
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
    const [independent, setIndependent] = useState(initial?.independent ?? false);
    const [saving, setSaving] = useState(false);

    /// Live "how it reads" summary — mirrors what the coupon card / POS shows.
    const preview = useMemo(() => {
        const prod = (id: number | null) => (id == null ? null : products.find((p) => p.id === id));
        const buy = prod(buyProductId);
        const get = prod(freeProductId);
        const pct = freeDiscountPct.trim() === "" ? null : Number(freeDiscountPct);
        const pctLabel = pct != null && pct < 100 ? ` at ${pct}% off` : "";

        let main: string | null = null;
        switch (type) {
            case "PERCENT": main = percentOff.trim() ? `${percentOff}% off${maxDiscountAmt.trim() ? ` (max ₹${maxDiscountAmt})` : ""}` : null; break;
            case "FLAT": main = flatAmt.trim() ? `₹${flatAmt} off the bill` : null; break;
            case "SET_PRICE": main = setPriceAmt.trim() ? `₹${setPriceAmt} each` : null; break;
            case "FREE_ITEM":
                main = get
                    ? `FREE — ${freeQty || 1} × ${get.name}${pctLabel}`
                    : null;
                break;
            case "BOGO":
                main = `BUY ${buyQty || 1} GET ${getQty || 1}${get ? ` — ${get.name}` : buy ? ` — ${buy.name}` : ""}${pctLabel}`;
                break;
        }
        return main;
    }, [type, percentOff, maxDiscountAmt, flatAmt, freeProductId, freeQty, freeDiscountPct, buyProductId, buyQty, getQty, setPriceAmt, products]);

    async function save() {
        if (!name.trim()) return toast.error("Name the coupon");
        if (type === "PERCENT" && optNum(percentOff) == null) return toast.error("Enter a % off");
        if (type === "FLAT" && optNum(flatAmt) == null) return toast.error("Enter a flat ₹ amount");
        if (type === "FREE_ITEM" && freeProductId == null) return toast.error("Pick the offer item");
        if (type === "BOGO" && freeProductId == null && buyProductId == null) return toast.error("Pick the buy and/or get item");
        if (type === "SET_PRICE" && optNum(setPriceAmt) == null) return toast.error("Enter the set ₹ price");

        const payload = {
            // Every coupon carries a code — auto-generated when left blank.
            code: (code.trim() || generateCode(name.trim() || "COUPON")).toUpperCase(),
            name: name.trim(),
            description: description.trim() || null,
            type, channels,
            applyMode: autoApply ? "AUTO" : "CODE",
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
            // Independent free-grant (FREE_ITEM / BOGO): the item rides the bill
            // as a zero-price FREE line on top of everything — no ₹ discount.
            independent: type === "FREE_ITEM" || type === "BOGO" ? independent : false,
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
        <div className={embedded ? "space-y-5" : "space-y-5 rounded-lg border border-dashed border-border/70 bg-muted/20 p-4"}>
            {!embedded && (
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{editing ? `Edit ${initial!.code ?? initial!.name}` : "New coupon"}</span>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCancel}><X size={14} /></Button>
                </div>
            )}

            {/* Live preview — how the offer reads on the card / at POS */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-primary/15 bg-gradient-to-r from-primary/[0.07] via-primary/[0.03] to-transparent px-3 py-2">
                <Sparkles size={13} className="shrink-0 text-primary" />
                {preview
                    ? <span className="text-sm font-semibold">{preview}</span>
                    : <span className="text-xs text-muted-foreground">Fill in the offer to preview how it reads.</span>}
                {name.trim() && <span className="text-xs text-muted-foreground">{name.trim()}</span>}
                <span className="hidden h-4 w-px bg-border/70 sm:block" />
                {autoApply && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">Auto-apply</span>}
                {code.trim() && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{code.trim().toUpperCase()}</span>}
                {minBillValue.trim() && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Min ₹{minBillValue}</span>}
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{CHANNEL_LABEL[channels]}</span>
                {independent && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">free on top</span>}
                {stackable && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">stackable</span>}
            </div>

            {/* ── Basics ─────────────────────────────────────────── */}
            <Section title="Basics">
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Code">
                        <div className="relative">
                            <Input
                                value={code}
                                onChange={(e) => setCode(e.target.value.toUpperCase())}
                                placeholder="DIWALI20"
                                className="h-10 pr-9 font-mono uppercase"
                            />
                            <button
                                type="button"
                                onClick={() => setCode(generateCode(name.trim() || "COUPON"))}
                                title="Generate a code from the name"
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                                <Dices size={14} />
                            </button>
                        </div>
                    </Field>
                    <Field label="Channel">
                        <Select value={channels} onValueChange={(v) => setChannels(v as Coupon["channels"])}>
                            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="BOTH">POS + Online shop</SelectItem>
                                <SelectItem value="POS">POS only</SelectItem>
                                <SelectItem value="SHOP">Online shop only</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                </div>
                <Field label="Name">
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali 20% off" className="h-10" />
                </Field>
                <Field label="Description (optional)">
                    <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown to staff" className="min-h-[44px]" />
                </Field>
            </Section>

            {/* ── Offer ──────────────────────────────────────────── */}
            <Section title="Offer">
                {/* Type as a segmented picker — one tap, no dropdown. */}
                <div className="flex flex-wrap gap-1.5">
                    {TYPE_OPTIONS.map((t) => {
                        const Icon = t.icon;
                        const active = type === t.value;
                        return (
                            <button
                                key={t.value}
                                type="button"
                                onClick={() => setType(t.value)}
                                aria-pressed={active}
                                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${active
                                    ? "border-transparent bg-primary text-primary-foreground shadow-sm"
                                    : "border-border/70 bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                    }`}
                            >
                                <Icon size={14} />
                                {t.label}
                            </button>
                        );
                    })}
                </div>

                {type === "BOGO" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <MechanicBox title="Buy (paid)">
                            <Field label="Buy item (blank = any)">
                                <SearchableSelect<number>
                                    value={buyProductId}
                                    options={prodOpts}
                                    onChange={setBuyProductId}
                                    placeholder="— any item —"
                                    triggerClassName="h-10"
                                />
                            </Field>
                            <Field label="Buy qty (X)">
                                <Input inputMode="decimal" value={buyQty} onChange={(e) => setBuyQty(parseDecimalInput(e.target.value))} placeholder="1" className="h-10 text-right" />
                            </Field>
                        </MechanicBox>
                        <MechanicBox title="Get (free / discounted)">
                            <Field label="Get item (blank = same as buy)">
                                <SearchableSelect<number>
                                    value={freeProductId}
                                    options={prodOpts}
                                    onChange={setFreeProductId}
                                    placeholder="— same item —"
                                    triggerClassName="h-10"
                                />
                            </Field>
                            <Field label="Get qty (Y)">
                                <Input inputMode="decimal" value={getQty} onChange={(e) => setGetQty(parseDecimalInput(e.target.value))} placeholder="1" className="h-10 text-right" />
                            </Field>
                            <Field label="Discount % on get (100 = free)">
                                <Input inputMode="decimal" value={freeDiscountPct} onChange={(e) => setFreeDiscountPct(parseDecimalInput(e.target.value))} placeholder="100" className="h-10 text-right" />
                            </Field>
                        </MechanicBox>
                    </div>
                ) : (
                    <div className="space-y-3 rounded-xl border border-primary/15 bg-gradient-to-br from-primary/[0.06] to-transparent p-3">
                        {type === "PERCENT" && (
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="% off">
                                    <Input inputMode="decimal" value={percentOff} onChange={(e) => setPercentOff(parseDecimalInput(e.target.value))} placeholder="20" className="h-10 text-right" />
                                </Field>
                                <Field label="Max ₹ cap (optional)">
                                    <RupeeInput value={maxDiscountAmt} onChange={(v) => setMaxDiscountAmt(parseDecimalInput(v))} placeholder="500" />
                                </Field>
                            </div>
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
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="sm:col-span-2">
                                    <Field label="Offer item (must be in cart)">
                                        <SearchableSelect<number>
                                            value={freeProductId}
                                            options={prodOpts}
                                            onChange={setFreeProductId}
                                            placeholder="— pick item —"
                                            triggerClassName="h-10"
                                        />
                                    </Field>
                                </div>
                                <Field label="Free qty">
                                    <Input inputMode="decimal" value={freeQty} onChange={(e) => setFreeQty(parseDecimalInput(e.target.value))} placeholder="1" className="h-10 text-right" />
                                </Field>
                                <Field label="Discount % on it (100 = free)">
                                    <Input inputMode="decimal" value={freeDiscountPct} onChange={(e) => setFreeDiscountPct(parseDecimalInput(e.target.value))} placeholder="100" className="h-10 text-right" />
                                </Field>
                            </div>
                        )}
                    </div>
                )}
            </Section>

            {/* ── Item rules ─────────────────────────────────────── */}
            <Section title="Item rules (optional)" hint="no rules = applies to the whole bill">
                <RuleEditor rules={rules} setRules={setRules} masters={masters} prodOpts={prodOpts} />
                {type === "SET_PRICE" && rules.length === 0 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                        No item rule set — this will mark down EVERY product to the same ₹ price. Add a product/category/group/brand rule to target the clearance stock.
                    </p>
                )}
            </Section>

            {/* ── Validity & limits ──────────────────────────────── */}
            <Section title="Validity & limits">
                <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Valid from">
                        <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="h-10" />
                    </Field>
                    <Field label="Valid until">
                        <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="h-10" />
                    </Field>
                    <Field label="Min bill ₹ (optional)">
                        <RupeeInput value={minBillValue} onChange={(v) => setMinBillValue(parseDecimalInput(v))} placeholder="1000" />
                    </Field>
                    <Field label="Total uses (optional)">
                        <Input inputMode="numeric" value={totalUsageLimit} onChange={(e) => setTotalUsageLimit(parseDigitsInput(e.target.value))} placeholder="∞" className="h-10 text-right" />
                    </Field>
                    <Field label="Per-customer uses (optional)">
                        <Input inputMode="numeric" value={perCustomerLimit} onChange={(e) => setPerCustomerLimit(parseDigitsInput(e.target.value))} placeholder="∞" className="h-10 text-right" />
                    </Field>
                    <Field label="Eligibility">
                        <Select value={eligibility} onValueChange={(v) => setEligibility(v as Coupon["eligibility"])}>
                            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ANY">Any customer</SelectItem>
                                <SelectItem value="NEW">First-time only</SelectItem>
                                <SelectItem value="RETURNING">Returning only</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                </div>
            </Section>

            {/* ── Behaviour ──────────────────────────────────────── */}
            <Section title="Behaviour">
                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    <Toggle
                        label="Auto-apply"
                        hint="Applies automatically at checkout when the bill qualifies — the code still works for manual entry."
                        checked={autoApply}
                        onChange={setAutoApply}
                    />
                    <Toggle label="Single-use code" hint="One redemption total" checked={singleUse} onChange={setSingleUse} />
                    <Toggle label="Stackable" hint="Combine with tier + loyalty" checked={stackable} onChange={setStackable} />
                    {(type === "FREE_ITEM" || type === "BOGO") && (
                        <div className="sm:col-span-2">
                            <Toggle
                                label="Independent — free items on top"
                                hint="Adds the item(s) as zero-price FREE lines on top of any other coupon. Never drops tier / blocks loyalty."
                                checked={independent}
                                onChange={setIndependent}
                            />
                        </div>
                    )}
                </div>
                {!stackable && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm">
                        <span>When exclusive, blocks tier + loyalty on</span>
                        <Select value={stackScope} onValueChange={(v) => setStackScope(v as Coupon["stackScope"])}>
                            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="BILL">The whole bill</SelectItem>
                                <SelectItem value="LINE">Only this coupon&rsquo;s own items</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </Section>

            {/* Sticky action bar — always reachable while scrolling */}
            <div className="sticky bottom-0 -mx-4 -mb-4 mt-1 flex justify-end gap-2 rounded-b-xl border-t bg-muted/50 p-4">
                <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                <Button onClick={save} disabled={saving}><Save size={14} className="mr-1" /> {editing ? "Save" : "Create"}</Button>
            </div>
        </div>
    );
}

/// Labeled group header with a divider — keeps the long form scannable.
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
                <span className="h-px flex-1 bg-border/60" />
                {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
            </div>
            {children}
        </div>
    );
}

/// Bordered panel with a mini header — used for the BOGO buy/get halves.
function MechanicBox({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
                {title}
            </p>
            {children}
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
            <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-10 pl-6 text-right" />
        </div>
    );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="flex items-start gap-2.5">
            <Switch className="mt-0.5" checked={checked} onCheckedChange={onChange} />
            <span className="text-sm leading-snug">
                {label}
                {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
            </span>
        </label>
    );
}
