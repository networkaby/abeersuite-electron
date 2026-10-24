"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DEFAULT_SHOP_PUBLISH_RULES,
    SHOP_REQUIREMENT_LABELS,
    type ShopPublishRules,
    type ShopRequirementKey,
} from "@/modules/ecommerce/lib/shopQualification";
import {
    DEFAULT_OUT_OF_STOCK_POLICY,
    OUT_OF_STOCK_POLICY_LABELS,
    type ShopOutOfStockPolicy,
} from "@/modules/ecommerce/lib/shopStock";
import { getWithRetry } from "@/shared/lib/http/getWithRetry";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { useSession } from "next-auth/react";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import PhotoCleanupCard from "@/modules/ecommerce/components/PhotoCleanupCard";

// Retry transient GET failures (dev-compile hiccups) a couple of times so the
// page reflects the real saved state instead of silently falling back to a
// default — which could otherwise be saved over the owner's real config.
export default function EcommerceSettingsPage() {
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canCleanPhotos = hasPermissionWithScope(permissions, PERMISSIONS.ECOMMERCE_PHOTO_CLEANUP);
    const [rules, setRules] = useState<ShopPublishRules>(DEFAULT_SHOP_PUBLISH_RULES);
    const [rulesLoaded, setRulesLoaded] = useState(false);
    const [rulesError, setRulesError] = useState(false);
    const [saving, setSaving] = useState(false);
    // Last copy the server answered with — a live refresh only lands while the
    // screen still matches it, so it never wipes a switch the owner has flipped.
    const [savedRules, setSavedRules] = useState<ShopPublishRules | null>(null);

    const [policy, setPolicy] = useState<ShopOutOfStockPolicy>(DEFAULT_OUT_OF_STOCK_POLICY);
    const [policyLoaded, setPolicyLoaded] = useState(false);
    const [policyError, setPolicyError] = useState(false);
    const [savingPolicy, setSavingPolicy] = useState(false);
    const [savedPolicy, setSavedPolicy] = useState<ShopOutOfStockPolicy | null>(null);

    const fetchRules = useCallback(() => getWithRetry<{ rules: ShopPublishRules }>("/api/ecommerce/publish-rules").then(
        (data) => { setRules(data.rules); setSavedRules(data.rules); setRulesLoaded(true); },
        () => { setRulesError(true); },
    ), []);
    /** Retry / refresh: clears the error first. */
    const loadRules = useCallback(() => {
        setRulesError(false);
        return fetchRules();
    }, [fetchRules]);

    const fetchPolicy = useCallback(() => getWithRetry<{ policy: ShopOutOfStockPolicy }>("/api/ecommerce/stock-policy").then(
        (data) => { setPolicy(data.policy); setSavedPolicy(data.policy); setPolicyLoaded(true); },
        () => { setPolicyError(true); },
    ), []);
    const loadPolicy = useCallback(() => {
        setPolicyError(false);
        return fetchPolicy();
    }, [fetchPolicy]);

    // First read: both error flags already start false.
    useEffect(() => {
        void fetchRules();
        void fetchPolicy();
    }, [fetchRules, fetchPolicy]);

    const rulesDirty = savedRules !== null && JSON.stringify(rules) !== JSON.stringify(savedRules);
    const policyDirty = savedPolicy !== null && policy !== savedPolicy;
    useRealtimeTopics(["catalogue"], () => { void loadRules(); }, !rulesDirty && !saving);
    useRealtimeTopics(["catalogue"], () => { void loadPolicy(); }, !policyDirty && !savingPolicy);

    const save = async () => {
        setSaving(true);
        try {
            const { data } = await axios.put<{ rules: ShopPublishRules }>("/api/ecommerce/publish-rules", rules);
            setRules(data.rules);
            setSavedRules(data.rules);
            toast.success("Publish rules saved");
        } catch {
            toast.error("Failed to save publish rules");
        } finally {
            setSaving(false);
        }
    };

    const savePolicy = async () => {
        setSavingPolicy(true);
        try {
            const { data } = await axios.put<{ policy: ShopOutOfStockPolicy }>("/api/ecommerce/stock-policy", {
                policy,
            });
            setPolicy(data.policy);
            setSavedPolicy(data.policy);
            toast.success("Out-of-stock policy saved");
        } catch {
            toast.error("Failed to save policy");
        } finally {
            setSavingPolicy(false);
        }
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-xl font-semibold">E-Commerce</h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Storefront settings that apply across every product.
                    </p>
                </div>

                <Card className="max-w-xl">
                    <CardHeader>
                        <CardTitle>Publish rules</CardTitle>
                        <CardDescription>
                            Choose which fields a product must have before it can be listed in the shop. Products
                            missing a required field show as <span className="font-medium">Needs info</span> on the
                            Products page and can’t be published.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {rulesError ? (
                            <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
                                <span className="text-destructive">Couldn’t load the current rules.</span>
                                <Button type="button" variant="outline" size="sm" onClick={() => void loadRules()}>
                                    Retry
                                </Button>
                            </div>
                        ) : (
                            <>
                                {(Object.keys(SHOP_REQUIREMENT_LABELS) as ShopRequirementKey[]).map((k) => (
                                    <div
                                        key={k}
                                        className="flex items-center justify-between rounded-md border border-border px-3 py-2.5"
                                    >
                                        <Label htmlFor={`rule-${k}`} className="font-normal">
                                            {SHOP_REQUIREMENT_LABELS[k]}
                                        </Label>
                                        <Switch
                                            id={`rule-${k}`}
                                            checked={rules[k]}
                                            disabled={!rulesLoaded || saving}
                                            onCheckedChange={(v) => setRules((r) => ({ ...r, [k]: v }))}
                                        />
                                    </div>
                                ))}
                                <div className="flex items-center justify-end gap-3 pt-1">
                                    {!rulesLoaded ? (
                                        <span className="text-muted-foreground text-xs">Loading…</span>
                                    ) : null}
                                    <Button type="button" onClick={() => void save()} disabled={!rulesLoaded || saving}>
                                        {saving ? "Saving…" : "Save rules"}
                                    </Button>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>

                <Card className="max-w-xl">
                    <CardHeader>
                        <CardTitle>Out-of-stock policy</CardTitle>
                        <CardDescription>
                            What the shop does with a stock-tracked product that hits zero stock. A product can override
                            this with <span className="font-medium">“Allow orders when out of stock”</span> on its edit
                            page.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {policyError ? (
                            <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
                                <span className="text-destructive">Couldn’t load the current policy.</span>
                                <Button type="button" variant="outline" size="sm" onClick={() => void loadPolicy()}>
                                    Retry
                                </Button>
                            </div>
                        ) : (
                            <>
                                <div className="grid gap-1.5">
                                    <Label htmlFor="oos-policy" className="font-normal">
                                        Default behaviour
                                    </Label>
                                    <Select
                                        value={policy}
                                        onValueChange={(v) => setPolicy(v as ShopOutOfStockPolicy)}
                                        disabled={!policyLoaded || savingPolicy}
                                    >
                                        <SelectTrigger id="oos-policy" className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {(Object.keys(OUT_OF_STOCK_POLICY_LABELS) as ShopOutOfStockPolicy[]).map((p) => (
                                                <SelectItem key={p} value={p}>
                                                    {OUT_OF_STOCK_POLICY_LABELS[p]}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="flex items-center justify-end gap-3 pt-1">
                                    {!policyLoaded ? (
                                        <span className="text-muted-foreground text-xs">Loading…</span>
                                    ) : null}
                                    <Button
                                        type="button"
                                        onClick={() => void savePolicy()}
                                        disabled={!policyLoaded || savingPolicy}
                                    >
                                        {savingPolicy ? "Saving…" : "Save policy"}
                                    </Button>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>

                {canCleanPhotos && <PhotoCleanupCard />}
            </div>
        </ScrollArea>
    );
}
