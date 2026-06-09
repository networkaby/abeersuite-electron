"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, X, Plus, Pencil, Trash2, Globe, Monitor, KeyRound } from "lucide-react";
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
    PAYMENT_GATEWAY_PROVIDERS,
    getGatewayProvider,
    type PaymentGatewayProvider,
} from "@/modules/pos/lib/paymentGateways";

// ── Types mirroring the API ───────────────────────────────────────────────────

type EnvVarStatus = { name: string; present: boolean };
type CredentialStatus = {
    provider: string;
    environment: "TEST" | "LIVE";
    vars: EnvVarStatus[];
    ready: boolean;
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
    enabledForCounter: boolean;
    enabledForOnline: boolean;
    config: Record<string, string>;
    isActive: boolean;
};

const EMPTY_FORM: FormState = {
    id: null,
    provider: PAYMENT_GATEWAY_PROVIDERS[0]?.id ?? "razorpay",
    displayName: "",
    environment: "TEST",
    enabledForCounter: true,
    enabledForOnline: false,
    config: {},
    isActive: true,
};

async function getWithRetry<T>(url: string, tries = 3, delayMs = 400): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < tries; i++) {
        try {
            return (await axios.get<T>(url)).data;
        } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
    throw lastErr;
}

function CredentialBadge({ status }: { status: CredentialStatus }) {
    // MANUAL providers declare no env vars — nothing to detect.
    if (status.vars.length === 0) {
        return <Badge className="bg-muted text-muted-foreground">No keys needed</Badge>;
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

export default function PaymentMethodsSettingsPage() {
    const [gateways, setGateways] = useState<Gateway[]>([]);
    const [statuses, setStatuses] = useState<StatusesMap>({});
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState(false);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

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

    const openCreate = () => {
        setForm(EMPTY_FORM);
        setDialogOpen(true);
    };

    const openEdit = (g: Gateway) => {
        setForm({
            id: g.id,
            provider: g.provider,
            displayName: g.displayName,
            environment: g.environment,
            enabledForCounter: g.enabledForCounter,
            enabledForOnline: g.enabledForOnline,
            config: Object.fromEntries(
                Object.entries(g.configJson ?? {}).map(([k, v]) => [k, String(v ?? "")]),
            ),
            isActive: g.isActive,
        });
        setDialogOpen(true);
    };

    const save = async () => {
        if (!provider) return;
        if (!form.displayName.trim()) {
            toast.error("Display name is required");
            return;
        }
        setSaving(true);
        const payload = {
            provider: form.provider,
            displayName: form.displayName.trim(),
            environment: form.environment,
            enabledForCounter: provider.supportsCounter ? form.enabledForCounter : false,
            enabledForOnline: provider.supportsOnline ? form.enabledForOnline : false,
            configJson: form.config,
            isActive: form.isActive,
        };
        try {
            if (form.id == null) {
                await axios.post("/api/settings/payment-methods", payload);
                toast.success("Payment method added");
            } else {
                // provider can't change on edit; send everything else.
                const { provider: _p, ...patch } = payload;
                void _p;
                await axios.patch(`/api/settings/payment-methods/${form.id}`, patch);
                toast.success("Payment method updated");
            }
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

    const remove = async (g: Gateway) => {
        if (
            !window.confirm(
                `Delete "${g.displayName}"?` +
                    (g.counterCount > 0
                        ? ` ${g.counterCount} counter rail(s) will be unlinked from it.`
                        : ""),
            )
        ) {
            return;
        }
        try {
            await axios.delete(`/api/settings/payment-methods/${g.id}`);
            toast.success("Payment method deleted");
            await load();
        } catch (e) {
            const msg = axios.isAxiosError(e)
                ? (e.response?.data?.error ?? "Failed to delete")
                : "Failed to delete";
            toast.error(msg);
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-semibold">Payment Methods</h1>
                        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
                            Configure the payment gateways and methods used across the business. A
                            counter picks one of these for its rails under{" "}
                            <span className="font-medium">Admin → POS Counters</span>; online
                            checkout uses the one marked “Online”. API keys live in environment
                            variables — this page only shows whether they’re detected, never their
                            values.
                        </p>
                    </div>
                    <Button type="button" onClick={openCreate} disabled={!loaded}>
                        <Plus className="mr-1 size-4" /> Add method
                    </Button>
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
                                No payment methods configured yet. Add Razorpay, Cashfree, or a
                                manual UPI method to get started.
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-3">
                        {gateways.map((g) => {
                            const prov = getGatewayProvider(g.provider);
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

                                        <Badge
                                            className={
                                                g.environment === "LIVE"
                                                    ? "bg-orange-100 text-orange-700"
                                                    : "bg-blue-100 text-blue-700"
                                            }
                                        >
                                            {g.environment}
                                        </Badge>

                                        {g.enabledForCounter && (
                                            <Badge className="bg-teal-100 text-teal-700">
                                                <Monitor className="mr-1 size-3" /> Counter
                                            </Badge>
                                        )}
                                        {g.enabledForOnline && (
                                            <Badge className="bg-indigo-100 text-indigo-700">
                                                <Globe className="mr-1 size-3" /> Online
                                            </Badge>
                                        )}

                                        <CredentialBadge status={g.credentialStatus} />

                                        <div className="flex items-center gap-1">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => openEdit(g)}
                                                aria-label="Edit"
                                            >
                                                <Pencil className="size-4" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => void remove(g)}
                                                aria-label="Delete"
                                            >
                                                <Trash2 className="size-4 text-destructive" />
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {form.id == null ? "Add payment method" : "Edit payment method"}
                        </DialogTitle>
                        <DialogDescription>
                            Secret API keys are never entered here — set them in environment
                            variables. This form holds only non-secret configuration.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="grid gap-1.5">
                            <Label>Provider</Label>
                            <Select
                                value={form.provider}
                                onValueChange={(v) =>
                                    setForm((f) => ({ ...f, provider: v, config: {}, enabledForOnline: false }))
                                }
                                disabled={form.id != null /* provider fixed after create */}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PAYMENT_GATEWAY_PROVIDERS.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

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
                            <div className="rounded-md border border-border px-3 py-2.5">
                                <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                                    <KeyRound className="size-3.5" /> API credentials (
                                    {form.environment === "LIVE" ? "Live" : "Test"})
                                </div>
                                {formCredential && formCredential.vars.length > 0 ? (
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

                        <div className="space-y-2">
                            {provider?.supportsCounter && (
                                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
                                    <Label htmlFor="pm-counter" className="font-normal">
                                        Available at the counter
                                    </Label>
                                    <Switch
                                        id="pm-counter"
                                        checked={form.enabledForCounter}
                                        onCheckedChange={(v) =>
                                            setForm((f) => ({ ...f, enabledForCounter: v }))
                                        }
                                    />
                                </div>
                            )}
                            {provider?.supportsOnline && (
                                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
                                    <div>
                                        <Label htmlFor="pm-online" className="font-normal">
                                            Use for online checkout
                                        </Label>
                                        <p className="text-muted-foreground text-[11px]">
                                            Only one method per environment can be the online
                                            gateway.
                                        </p>
                                    </div>
                                    <Switch
                                        id="pm-online"
                                        checked={form.enabledForOnline}
                                        onCheckedChange={(v) =>
                                            setForm((f) => ({ ...f, enabledForOnline: v }))
                                        }
                                    />
                                </div>
                            )}
                            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
                                <Label htmlFor="pm-active" className="font-normal">
                                    Active
                                </Label>
                                <Switch
                                    id="pm-active"
                                    checked={form.isActive}
                                    onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                                />
                            </div>
                        </div>
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
