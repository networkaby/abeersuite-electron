"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, X, Pencil, Globe, Monitor, KeyRound, ChevronDown, MapPin, Percent, Split } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
    DEFAULT_SPLIT_MAX_PARTS,
    getGatewayProvider,
    isKeylessMethod,
    mdrRuleOf,
    PAY_ON_DELIVERY_PROVIDER_ID,
    settlementAccountIdOf,
    splitRuleOf,
    type MdrRule,
    type PaymentGatewayProvider,
} from "@/modules/pos/lib/paymentGateways";
import { NumericInput } from "@/shared/components/NumericInput";
import { INDIA_STATE_NAMES } from "@/modules/delivery/lib/deliveryMethodConfig";
import { sanitizePodArea, type PodAreaMode } from "@/shared/lib/payments/payOnDelivery";
import { GlAccountCombobox, type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { isOdGroupName } from "@/modules/accountancy/lib/bankParticulars";
import { Landmark } from "lucide-react";
import { getWithRetry } from "@/shared/lib/http/getWithRetry";

// ── Types mirroring the API ───────────────────────────────────────────────────

type EnvVarStatus = { name: string; present: boolean };
type CredentialStatus = {
    provider: string;
    environment: "TEST" | "LIVE";
    vars: EnvVarStatus[];
    ready: boolean;
    /** Desktop app: keys live on the office website, not on this PC. */
    checkedOnOffice: boolean;
};
type Gateway = {
    id: number;
    provider: string;
    displayName: string;
    environment: "TEST" | "LIVE";
    enabledForCounter: boolean;
    enabledForOnline: boolean;
    configJson: Record<string, unknown>;
    sortOrder: number;
    isActive: boolean;
    counterCount: number;
    credentialStatus: CredentialStatus;
};
type StatusesMap = Record<string, { test: CredentialStatus; live: CredentialStatus }>;

type FormState = {
    id: number | null;
    provider: string;
    displayName: string;
    environment: "TEST" | "LIVE";
    config: Record<string, string>;
    // The GL ledger money collected via this method settles into (Cash/Bank asset
    // ledger). Stored on configJson.settlementAccountId. null = not set yet.
    settlementAccountId: number | null;
    // Pay-on-Delivery area rule (only meaningful when provider is pay_on_delivery).
    podMode: PodAreaMode;
    podStates: string[];
    podPincodes: string; // prefixes, one per line / comma-separated
    // Bank charge (MDR) at the counter — configJson.mdr. Strings while typing.
    mdrRate: string;
    mdrFreeUpTo: string;
    mdrCap: string;
    // UPI only — take a big UPI payment in parts (configJson.split).
    splitEnabled: boolean;
    splitMaxParts: string;
};

const EMPTY_FORM: FormState = {
    id: null,
    provider: PAY_ON_DELIVERY_PROVIDER_ID, // overwritten by openEdit; never created fresh
    displayName: "",
    environment: "TEST",
    config: {},
    settlementAccountId: null,
    podMode: "except",
    podStates: [],
    podPincodes: "",
    mdrRate: "",
    mdrFreeUpTo: "",
    mdrCap: "",
    splitEnabled: false,
    splitMaxParts: String(DEFAULT_SPLIT_MAX_PARTS),
};

// configJson keys with their own form fields — kept out of the flat string map.
const OWN_FIELD_KEYS = new Set(["mdr", "split"]);

/** "MDR 0.4% > ₹1,999" — the card badge for a method with a bank charge. */
function mdrSummary(rule: MdrRule): string {
    const free = rule.freeUpToRupees > 0 ? ` > ₹${rule.freeUpToRupees.toLocaleString("en-IN")}` : "";
    const cap = rule.capRupees > 0 ? `, max ₹${rule.capRupees.toLocaleString("en-IN")}` : "";
    return `MDR ${rule.ratePct}%${free}${cap}`;
}

/** One-line summary of the POD rail's area rule, for its card badge. */
function podAreaSummary(g: Gateway): string {
    const a = sanitizePodArea((g.configJson as { area?: unknown })?.area);
    const n = a.states.length + a.pincodePrefixes.length;
    if (n === 0) return "Everywhere";
    return a.mode === "only" ? `Only ${n} area${n > 1 ? "s" : ""}` : `Except ${n} area${n > 1 ? "s" : ""}`;
}

function CredentialBadge({ status }: { status: CredentialStatus }) {
    // MANUAL providers declare no env vars — nothing to detect.
    if (status.vars.length === 0) {
        return <Badge className="bg-muted text-muted-foreground">No keys needed</Badge>;
    }
    if (status.checkedOnOffice) {
        return <Badge className="bg-muted text-muted-foreground">Checked on office website</Badge>;
    }
    return status.ready ? (
        <Badge className="bg-green-100 text-green-700">
            <Check className="mr-1 size-3" /> Keys detected
        </Badge>
    ) : (
        <Badge className="bg-red-100 text-red-600">
            <X className="mr-1 size-3" /> Keys missing
        </Badge>
    );
}

function FlagSwitch({
    id,
    label,
    icon,
    checked,
    onChange,
}: {
    id: string;
    label: string;
    icon?: React.ReactNode;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <div className="flex items-center gap-1.5">
            <Switch id={id} checked={checked} onCheckedChange={onChange} />
            <Label htmlFor={id} className="flex items-center gap-1 text-xs font-normal">
                {icon}
                {label}
            </Label>
        </div>
    );
}

export default function PaymentMethodsSettingsPage() {
    const [gateways, setGateways] = useState<Gateway[]>([]);
    const [statuses, setStatuses] = useState<StatusesMap>({});
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState(false);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    // Cash/Bank asset ledgers a method's proceeds may settle into (same set the
    // counter payment accounts pick from).
    const [glAccounts, setGlAccounts] = useState<GlAccount[]>([]);

    const load = useCallback(async () => {
        setLoadError(false);
        try {
            const [list, cred] = await Promise.all([
                getWithRetry<{ gateways: Gateway[] }>("/api/settings/payment-methods"),
                getWithRetry<{ statuses: StatusesMap }>(
                    "/api/settings/payment-methods/credential-status",
                ),
            ]);
            setGateways(list.gateways);
            setStatuses(cred.statuses);
            setLoaded(true);
        } catch {
            setLoadError(true);
        }
    }, []);

    // Load the ledgers money can settle into. Any asset group qualifies —
    // Cash-in-Hand, Bank Accounts, or a custom group like "Gateway" under
    // Current Assets (party ledgers already excluded by the API flag). Bank OD
    // A/c is added explicitly: it is a normal current account for money
    // movement even though it reports as a liability (see moneyAccount.ts).
    const loadGlAccounts = useCallback(() => {
        axios
            .get<GlAccount[]>("/api/accountancy/gl-accounts?includeParties=false")
            .then((r) => setGlAccounts(r.data.filter((a) =>
                a.group?.type === "ASSET" || isOdGroupName(a.group?.name))))
            .catch(() => setGlAccounts([]));
    }, []);
    useEffect(loadGlAccounts, [loadGlAccounts]);

    const accountName = useCallback(
        (id: number | null) => (id ? (glAccounts.find((a) => a.id === id)?.name ?? null) : null),
        [glAccounts],
    );

    useEffect(() => {
        void load();
    }, [load]);

    const provider: PaymentGatewayProvider | undefined = useMemo(
        () => getGatewayProvider(form.provider),
        [form.provider],
    );

    const formCredential: CredentialStatus | undefined = useMemo(() => {
        const s = statuses[form.provider];
        if (!s) return undefined;
        return form.environment === "LIVE" ? s.live : s.test;
    }, [statuses, form.provider, form.environment]);

    const openEdit = (g: Gateway) => {
        const isPod = g.provider === PAY_ON_DELIVERY_PROVIDER_ID;
        const area = isPod ? sanitizePodArea((g.configJson as { area?: unknown })?.area) : null;
        const mdr = mdrRuleOf(g.configJson);
        const split = splitRuleOf(g.configJson);
        setForm({
            id: g.id,
            provider: g.provider,
            displayName: g.displayName,
            environment: g.environment,
            // POD's configJson holds a nested area object, not flat string fields;
            // MDR + split are objects with fields of their own below.
            config: isPod
                ? {}
                : Object.fromEntries(
                      Object.entries(g.configJson ?? {})
                          .filter(([k]) => !OWN_FIELD_KEYS.has(k))
                          .map(([k, v]) => [k, String(v ?? "")]),
                  ),
            settlementAccountId: settlementAccountIdOf(g.configJson),
            podMode: area?.mode ?? "except",
            podStates: area?.states ?? [],
            podPincodes: (area?.pincodePrefixes ?? []).join("\n"),
            mdrRate: mdr && mdr.ratePct > 0 ? String(mdr.ratePct) : "",
            mdrFreeUpTo: mdr && mdr.freeUpToRupees > 0 ? String(mdr.freeUpToRupees) : "",
            mdrCap: mdr && mdr.capRupees > 0 ? String(mdr.capRupees) : "",
            splitEnabled: split?.enabled ?? false,
            splitMaxParts: String(split?.maxParts ?? DEFAULT_SPLIT_MAX_PARTS),
        });
        setDialogOpen(true);
    };

    // The Counter / Online / Active switches live on each card and save at once —
    // optimistic, put back if the server refuses.
    type Flag = "enabledForCounter" | "enabledForOnline" | "isActive";
    const toggle = async (g: Gateway, flag: Flag, value: boolean) => {
        const put = (v: boolean) =>
            setGateways((list) => list.map((x) => (x.id === g.id ? { ...x, [flag]: v } : x)));
        put(value);
        try {
            await axios.patch(`/api/settings/payment-methods/${g.id}`, { [flag]: value });
        } catch (e) {
            put(!value);
            toast.error(
                axios.isAxiosError(e) ? (e.response?.data?.error ?? "Failed to save") : "Failed to save",
            );
        }
    };

    // The UPI card's Split switch — same at-once save, but it lives on configJson,
    // so the whole configJson goes back with only split.enabled flipped.
    const toggleSplit = async (g: Gateway, value: boolean) => {
        if (value && !(mdrRuleOf(g.configJson)?.freeUpToRupees ?? 0)) {
            toast.error("Set the UPI free limit first (Edit → Bank charge, e.g. ₹1,999) — parts are cut at it.");
            return;
        }
        const before = g.configJson;
        const next = {
            ...before,
            split: { enabled: value, maxParts: splitRuleOf(before)?.maxParts ?? DEFAULT_SPLIT_MAX_PARTS },
        };
        const put = (configJson: Record<string, unknown>) =>
            setGateways((list) => list.map((x) => (x.id === g.id ? { ...x, configJson } : x)));
        put(next);
        try {
            await axios.patch(`/api/settings/payment-methods/${g.id}`, { configJson: next });
        } catch (e) {
            put(before);
            toast.error(
                axios.isAxiosError(e) ? (e.response?.data?.error ?? "Failed to save") : "Failed to save",
            );
        }
    };

    const save = async () => {
        if (!provider) return;
        if (!form.displayName.trim()) {
            toast.error("Display name is required");
            return;
        }
        setSaving(true);
        const isPod = form.provider === PAY_ON_DELIVERY_PROVIDER_ID;
        // POD stores an area rule; everything else stores its flat config fields.
        const configJson: Record<string, unknown> = isPod
            ? {
                  area: {
                      mode: form.podMode,
                      states: form.podStates,
                      pincodePrefixes: form.podPincodes
                          .split(/[\n,]/u)
                          .map((s) => s.trim())
                          .filter(Boolean),
                  },
              }
            : { ...form.config };
        // The settlement ledger is common to every method — layer it onto configJson.
        if (form.settlementAccountId) configJson.settlementAccountId = form.settlementAccountId;
        // Bank charge (MDR) — kept while a rate or a free limit is set (the UPI
        // free limit also cuts the split parts); cleared otherwise.
        if (provider.supportsCounter) {
            const ratePct = Number(form.mdrRate) || 0;
            const freeUpToRupees = Number(form.mdrFreeUpTo) || 0;
            if (ratePct > 0 || freeUpToRupees > 0) {
                configJson.mdr = { ratePct, freeUpToRupees, capRupees: Number(form.mdrCap) || 0 };
            }
            if (provider.channel === "UPI") {
                configJson.split = {
                    enabled: form.splitEnabled,
                    maxParts: Number(form.splitMaxParts) || DEFAULT_SPLIT_MAX_PARTS,
                };
            }
        }
        const payload = {
            provider: form.provider,
            displayName: form.displayName.trim(),
            environment: form.environment,
            configJson,
        };
        try {
            // Fixed catalog — always an edit; the provider itself never changes.
            const { provider: _p, ...patch } = payload;
            void _p;
            await axios.patch(`/api/settings/payment-methods/${form.id}`, patch);
            toast.success("Payment method updated");
            setDialogOpen(false);
            await load();
        } catch (e) {
            const msg = axios.isAxiosError(e)
                ? (e.response?.data?.error ?? "Failed to save")
                : "Failed to save";
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-xl font-semibold">Payment Methods</h1>
                    <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
                        A fixed set of payment methods — switch each on or off, but you can’t add
                        or remove them (a new one is added in code). Methods switched on for
                        “Counter” are what <span className="font-medium">Admin → POS Counters</span>{" "}
                        offers in its method list; online checkout offers the ones on for “Online”.
                        API keys live in environment variables — this page only shows whether
                        they’re detected, never their values.
                    </p>
                </div>

                {loadError ? (
                    <div className="flex max-w-xl items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
                        <span className="text-destructive">Couldn’t load payment methods.</span>
                        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                            Retry
                        </Button>
                    </div>
                ) : !loaded ? (
                    <p className="text-muted-foreground text-sm">Loading…</p>
                ) : gateways.length === 0 ? (
                    <Card className="max-w-xl">
                        <CardContent className="py-8 text-center">
                            <p className="text-muted-foreground text-sm">
                                Loading the payment methods…
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-3">
                        {gateways.map((g) => {
                            const prov = getGatewayProvider(g.provider);
                            const mdr = prov?.supportsCounter ? mdrRuleOf(g.configJson) : null;
                            return (
                                <Card key={g.id} className="max-w-3xl">
                                    <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
                                        <div className="min-w-40 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{g.displayName}</span>
                                                {!g.isActive && (
                                                    <Badge className="bg-muted text-muted-foreground">
                                                        Inactive
                                                    </Badge>
                                                )}
                                            </div>
                                            <span className="text-muted-foreground text-xs">
                                                {prov?.label ?? g.provider}
                                            </span>
                                        </div>

                                        {/* Environment is meaningless for keyless methods. */}
                                        {!isKeylessMethod(g.provider) && (
                                            <Badge
                                                className={
                                                    g.environment === "LIVE"
                                                        ? "bg-orange-100 text-orange-700"
                                                        : "bg-blue-100 text-blue-700"
                                                }
                                            >
                                                {g.environment}
                                            </Badge>
                                        )}

                                        {g.provider === PAY_ON_DELIVERY_PROVIDER_ID && (
                                            <Badge className="bg-amber-100 text-amber-700">
                                                <MapPin className="mr-1 size-3" /> {podAreaSummary(g)}
                                            </Badge>
                                        )}

                                        {!isKeylessMethod(g.provider) && (
                                            <CredentialBadge status={g.credentialStatus} />
                                        )}

                                        {/* Settlement ledger — warn when a payable online gateway has none. */}
                                        {settlementAccountIdOf(g.configJson) ? (
                                            <Badge className="bg-slate-100 text-slate-700">
                                                <Landmark className="mr-1 size-3" />
                                                {accountName(settlementAccountIdOf(g.configJson)) ?? "Ledger set"}
                                            </Badge>
                                        ) : g.enabledForOnline ? (
                                            <Badge className="bg-red-100 text-red-600">
                                                <Landmark className="mr-1 size-3" /> No ledger
                                            </Badge>
                                        ) : null}

                                        {mdr && mdr.ratePct > 0 && (
                                            <Badge className="bg-violet-100 text-violet-700">
                                                <Percent className="mr-1 size-3" /> {mdrSummary(mdr)}
                                            </Badge>
                                        )}

                                        {/* Take a big UPI payment in parts under the free limit. */}
                                        {prov?.supportsCounter && prov.channel === "UPI" && (
                                            <FlagSwitch
                                                id={`pm-${g.id}-split`}
                                                label="Split"
                                                icon={<Split className="size-3" />}
                                                checked={splitRuleOf(g.configJson)?.enabled ?? false}
                                                onChange={(v) => void toggleSplit(g, v)}
                                            />
                                        )}

                                        {prov?.supportsCounter && (
                                            <FlagSwitch
                                                id={`pm-${g.id}-counter`}
                                                label="Counter"
                                                icon={<Monitor className="size-3" />}
                                                checked={g.enabledForCounter}
                                                onChange={(v) => void toggle(g, "enabledForCounter", v)}
                                            />
                                        )}
                                        {prov?.supportsOnline && (
                                            <FlagSwitch
                                                id={`pm-${g.id}-online`}
                                                label="Online"
                                                icon={<Globe className="size-3" />}
                                                checked={g.enabledForOnline}
                                                onChange={(v) => void toggle(g, "enabledForOnline", v)}
                                            />
                                        )}
                                        <FlagSwitch
                                            id={`pm-${g.id}-active`}
                                            label="Active"
                                            checked={g.isActive}
                                            onChange={(v) => void toggle(g, "isActive", v)}
                                        />

                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => openEdit(g)}
                                            aria-label="Edit"
                                        >
                                            <Pencil className="size-4" />
                                        </Button>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Edit {provider?.label ?? form.displayName}</DialogTitle>
                        <DialogDescription>
                            Secret API keys are never entered here — set them in environment
                            variables. This form holds only non-secret configuration.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                            <Label htmlFor="pm-name">Display name</Label>
                            <Input
                                id="pm-name"
                                value={form.displayName}
                                placeholder={provider?.label ?? "e.g. Razorpay (main)"}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, displayName: e.target.value }))
                                }
                            />
                        </div>

                        {/* Environment picks which env-var set is checked — irrelevant for
                            keyless Pay on delivery, so hidden for it. */}
                        {!isKeylessMethod(form.provider) && (
                            <div className="grid gap-1.5">
                                <Label>Environment</Label>
                                <Select
                                    value={form.environment}
                                    onValueChange={(v) =>
                                        setForm((f) => ({ ...f, environment: v as "TEST" | "LIVE" }))
                                    }
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="TEST">Test</SelectItem>
                                        <SelectItem value="LIVE">Live</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Pay-on-Delivery area rule — where the "pay later" rail is offered. */}
                        {form.provider === PAY_ON_DELIVERY_PROVIDER_ID && (
                            <div className="rounded-md border border-border p-3 space-y-3 sm:col-span-2">
                                <div className="flex items-center gap-1.5 text-sm font-medium">
                                    <MapPin className="size-3.5" /> Where it&apos;s offered
                                </div>
                                <div className="grid gap-1.5">
                                    <Label className="text-xs text-muted-foreground">Area rule</Label>
                                    <Select
                                        value={form.podMode}
                                        onValueChange={(v) =>
                                            setForm((f) => ({ ...f, podMode: v as PodAreaMode }))
                                        }
                                    >
                                        <SelectTrigger className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="except">
                                                Offer everywhere, except the areas below
                                            </SelectItem>
                                            <SelectItem value="only">
                                                Offer only in the areas below
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-1.5">
                                    <Label className="text-xs text-muted-foreground">States</Label>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="w-full justify-between gap-1 font-normal"
                                            >
                                                {form.podStates.length > 0
                                                    ? `${form.podStates.length} state${form.podStates.length > 1 ? "s" : ""} selected`
                                                    : "None"}
                                                <ChevronDown className="size-3.5 opacity-60" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
                                            {INDIA_STATE_NAMES.map((st) => (
                                                <DropdownMenuCheckboxItem
                                                    key={st}
                                                    checked={form.podStates.includes(st)}
                                                    onCheckedChange={() =>
                                                        setForm((f) => ({
                                                            ...f,
                                                            podStates: f.podStates.includes(st)
                                                                ? f.podStates.filter((x) => x !== st)
                                                                : [...f.podStates, st],
                                                        }))
                                                    }
                                                    onSelect={(e) => e.preventDefault()}
                                                >
                                                    {st}
                                                </DropdownMenuCheckboxItem>
                                            ))}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                                <div className="grid gap-1.5">
                                    <Label className="text-xs text-muted-foreground">Pincodes (prefixes)</Label>
                                    <textarea
                                        className="border-input bg-background flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                        value={form.podPincodes}
                                        placeholder="One prefix per line, e.g. 78 (all 78xxxx) or 781301"
                                        onChange={(e) =>
                                            setForm((f) => ({ ...f, podPincodes: e.target.value }))
                                        }
                                    />
                                    <p className="text-muted-foreground text-[11px]">
                                        {form.podStates.length === 0 && !form.podPincodes.trim()
                                            ? "No areas set — Pay on delivery is offered everywhere."
                                            : form.podMode === "only"
                                              ? "Pay on delivery shows only where the state or pincode-prefix matches."
                                              : "Pay on delivery is hidden where the state or pincode-prefix matches."}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Settlement ledger — the Cash/Bank ledger money collected via this
                            method books into (online receipts Dr this ledger). */}
                        <div className="grid gap-1.5">
                            <Label className="flex items-center gap-1.5">
                                <Landmark className="size-3.5" /> Settlement ledger
                            </Label>
                            <GlAccountCombobox
                                value={form.settlementAccountId}
                                onChange={(acc) => setForm((f) => ({ ...f, settlementAccountId: acc?.id ?? null }))}
                                accounts={glAccounts}
                                onMastersChanged={loadGlAccounts}
                                placeholder="Cash / Bank ledger money settles into…"
                            />
                            <p className="text-muted-foreground text-[11px]">
                                {form.provider === PAY_ON_DELIVERY_PROVIDER_ID
                                    ? "Where collected-on-delivery cash is booked when remitted."
                                    : provider?.kind === "MANUAL"
                                      ? "The default ledger this method books into. Each counter row picks its own."
                                      : "Online payments via this gateway post a Receipt debiting this ledger."}
                            </p>
                        </div>

                        {/* Bank charge (MDR) at the counter. The bill is the cash price;
                            a payment on this method raises the line prices toward their
                            tag by this charge — never above the tag (paymentMdr.ts). */}
                        {provider?.supportsCounter && (
                            <div className="rounded-md border border-border p-3 space-y-3 sm:col-span-2">
                                <div className="flex items-center gap-1.5 text-sm font-medium">
                                    <Percent className="size-3.5" /> Bank charge (MDR) at the counter
                                </div>
                                <div className="grid grid-cols-3 items-end gap-2 sm:grid-cols-5">
                                    <div className="grid gap-1">
                                        <Label htmlFor="pm-mdr-rate" className="text-xs text-muted-foreground">MDR %</Label>
                                        <NumericInput
                                            id="pm-mdr-rate"
                                            mode="decimal"
                                            min={0}
                                            max={10}
                                            value={form.mdrRate}
                                            placeholder="none"
                                            onValueChange={(v) => setForm((f) => ({ ...f, mdrRate: v }))}
                                        />
                                    </div>
                                    <div className="grid gap-1">
                                        <Label htmlFor="pm-mdr-free" className="text-xs text-muted-foreground">Free up to ₹</Label>
                                        <NumericInput
                                            id="pm-mdr-free"
                                            min={0}
                                            value={form.mdrFreeUpTo}
                                            placeholder="0"
                                            onValueChange={(v) => setForm((f) => ({ ...f, mdrFreeUpTo: v }))}
                                        />
                                    </div>
                                    <div className="grid gap-1">
                                        <Label htmlFor="pm-mdr-cap" className="text-xs text-muted-foreground">Max ₹ per payment</Label>
                                        <NumericInput
                                            id="pm-mdr-cap"
                                            mode="decimal"
                                            min={0}
                                            value={form.mdrCap}
                                            placeholder="no cap"
                                            onValueChange={(v) => setForm((f) => ({ ...f, mdrCap: v }))}
                                        />
                                    </div>
                                    {provider.channel === "UPI" && (
                                        <>
                                            <div className="flex h-9 items-center">
                                                <FlagSwitch
                                                    id="pm-split"
                                                    label="Split into parts"
                                                    icon={<Split className="size-3" />}
                                                    checked={form.splitEnabled}
                                                    onChange={(v) => setForm((f) => ({ ...f, splitEnabled: v }))}
                                                />
                                            </div>
                                            <div className="grid gap-1">
                                                <Label htmlFor="pm-split-max" className="text-xs text-muted-foreground">Max parts</Label>
                                                <NumericInput
                                                    id="pm-split-max"
                                                    min={2}
                                                    max={50}
                                                    value={form.splitMaxParts}
                                                    onValueChange={(v) => setForm((f) => ({ ...f, splitMaxParts: v }))}
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>
                                <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                                    <p className="text-muted-foreground text-[11px]">
                                        Per payment: nothing up to the free limit, above it this % of the
                                        whole payment. The bill stays the cash price; a payment by this
                                        method raises the line prices toward their tag by the charge, never
                                        above the tag — no room left and the shop bears it.
                                        {provider.channel === "UPI" && " UPI from 15 Oct 2026: 0.4% above ₹2,000 (free up to ₹1,999), max ₹300."}
                                    </p>
                                    {provider.channel === "UPI" && (
                                        <p className="text-muted-foreground text-[11px]">
                                            Split big UPI payments: each part stays within the free limit and has
                                            its own amount, one QR at a time. Past the max, the last part takes
                                            the rest and pays MDR.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Non-secret provider config fields (e.g. manual UPI VPA). */}
                        {provider?.configFields.map((field) => (
                            <div key={field.key} className="grid gap-1.5">
                                <Label htmlFor={`cfg-${field.key}`}>{field.label}</Label>
                                <Input
                                    id={`cfg-${field.key}`}
                                    value={form.config[field.key] ?? ""}
                                    placeholder={field.placeholder}
                                    onChange={(e) =>
                                        setForm((f) => ({
                                            ...f,
                                            config: { ...f.config, [field.key]: e.target.value },
                                        }))
                                    }
                                />
                            </div>
                        ))}

                        {/* Credential detection (read-only; names + ✓/✗ only). */}
                        {provider && provider.kind === "GATEWAY" && (
                            <div className="rounded-md border border-border px-3 py-2.5 sm:col-span-2">
                                <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                                    <KeyRound className="size-3.5" /> API credentials (
                                    {form.environment === "LIVE" ? "Live" : "Test"})
                                </div>
                                {formCredential?.checkedOnOffice && formCredential.vars.length > 0 ? (
                                    <p className="text-muted-foreground text-xs">
                                        This app does not carry payment keys. Open Payment Methods
                                        on the office website to see whether they are set.
                                    </p>
                                ) : formCredential && formCredential.vars.length > 0 ? (
                                    <ul className="space-y-1">
                                        {formCredential.vars.map((v) => (
                                            <li
                                                key={v.name}
                                                className="flex items-center justify-between text-xs"
                                            >
                                                <code className="text-muted-foreground">{v.name}</code>
                                                {v.present ? (
                                                    <span className="flex items-center gap-1 text-green-700">
                                                        <Check className="size-3" /> set
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1 text-red-600">
                                                        <X className="size-3" /> missing
                                                    </span>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-muted-foreground text-xs">
                                        No keys required.
                                    </p>
                                )}
                                <p className="text-muted-foreground mt-2 text-[11px]">
                                    Set these in your environment (.env / Vercel). Values are never
                                    shown or stored here.
                                </p>
                            </div>
                        )}

                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setDialogOpen(false)}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                        <Button type="button" onClick={() => void save()} disabled={saving}>
                            {saving ? "Saving…" : form.id == null ? "Add" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </ScrollArea>
    );
}
