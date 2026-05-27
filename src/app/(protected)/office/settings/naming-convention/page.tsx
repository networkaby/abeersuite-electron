"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    DEFAULT_NAMING_CONFIG,
    type FallbackMap,
    type NamingConfigShape,
    type NamingMasters,
    type NamingToken,
    type TokenKind,
    buildOfflineName,
    buildOnlineName,
    buildOnlineSlug,
} from "@/modules/inventory/lib/productName";

const TOKEN_LABEL: Record<TokenKind, string> = {
    brand:    "Brand",
    category: "Category",
    group:    "Group",
    modelNo:  "Model no.",
    warranty: "Warranty",
    unit:     "Unit",
    literal:  "Literal text",
    attr:     "Custom attribute",
    userPart: "Custom (user part)",
};

const ALL_KINDS: TokenKind[] = ["brand", "category", "group", "modelNo", "warranty", "unit", "attr", "userPart"];

// Sample product for the live preview — fixed so the owner sees consistent
// output across saves. Mirrors the InvProduct master shape passed to the
// builders from InvProductFormFields.
const PREVIEW_MASTERS: NamingMasters = {
    brand:    { name: "HP" },
    category: { name: "Laptop" },
    group:    { name: "Inspiron" },
    warranty: { name: "1-Year" },
    unit:     { code: "PCS" },
    modelNo:  "250-G9",
    userPart: "1.5M Special",
};

function move<T>(list: T[], from: number, dir: -1 | 1): T[] {
    const to = from + dir;
    if (to < 0 || to >= list.length) return list;
    const next = list.slice();
    [next[from], next[to]] = [next[to], next[from]];
    return next;
}

interface TokenListEditorProps {
    tokens: NamingToken[];
    onChange: (tokens: NamingToken[]) => void;
    /** Kinds that are not already in the list but can be added. "literal" is always addable. */
    available: TokenKind[];
    attrKeys?: Array<{ key: string; name: string }>;
}

function TokenListEditor({ tokens, onChange, available, attrKeys = [] }: TokenListEditorProps) {
    const [pendingKind, setPendingKind] = useState<TokenKind | "">("");

    const updateAt = (i: number, patch: Partial<NamingToken>) => {
        onChange(tokens.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
    };
    const removeAt = (i: number) => onChange(tokens.filter((_, idx) => idx !== i));

    const addToken = () => {
        if (!pendingKind) return;
        const next: NamingToken =
            pendingKind === "literal"
                ? { kind: "literal", enabled: true, literal: "", defaultValue: null }
                : pendingKind === "attr"
                ? { kind: "attr", enabled: true, attrKey: "", defaultValue: null }
                : { kind: pendingKind, enabled: true, defaultValue: null };
        onChange([...tokens, next]);
        setPendingKind("");
    };

    const canAdd = [...available, "literal" as TokenKind].filter(
        (k) => k === "literal" || !tokens.some((t) => t.kind === k),
    );

    return (
        <div className="space-y-2">
            {tokens.length === 0 ? (
                <p className="text-xs text-muted-foreground">No tokens — output will be empty.</p>
            ) : (
                <ul className="space-y-1">
                    {tokens.map((t, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2 border border-border bg-card px-2 py-1.5">
                            <div className="flex">
                                <Button type="button" variant="outline" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => onChange(move(tokens, i, -1))}>
                                    <ArrowUp className="size-4" />
                                </Button>
                                <Button type="button" variant="outline" size="icon-sm" aria-label="Move down" disabled={i === tokens.length - 1} onClick={() => onChange(move(tokens, i, 1))}>
                                    <ArrowDown className="size-4" />
                                </Button>
                            </div>
                            <label className="flex items-center gap-1.5 text-sm">
                                <input type="checkbox" checked={t.enabled} onChange={(e) => updateAt(i, { enabled: e.target.checked })} />
                                <span className="min-w-[90px] font-medium">{TOKEN_LABEL[t.kind]}</span>
                            </label>
                            <Input
                                className="w-20 font-mono text-xs"
                                value={t.prefix ?? ""}
                                onChange={(e) => updateAt(i, { prefix: e.target.value || null })}
                                placeholder="prefix"
                                title="Prefix — prepended before this token's value"
                            />
                            {t.kind === "literal" ? (
                                <Input
                                    className="max-w-[160px]"
                                    value={t.literal ?? ""}
                                    onChange={(e) => updateAt(i, { literal: e.target.value })}
                                    placeholder="fixed text"
                                />
                            ) : t.kind === "attr" ? (
                                <>
                                    {attrKeys.length > 0 ? (
                                        <Select
                                            value={t.attrKey ?? ""}
                                            onValueChange={(v) => updateAt(i, { attrKey: v || null })}
                                        >
                                            <SelectTrigger className="w-36">
                                                <SelectValue placeholder="attr key…" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {attrKeys.map((a) => (
                                                    <SelectItem key={a.key} value={a.key}>
                                                        {a.name} <span className="font-mono text-xs text-muted-foreground">({a.key})</span>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <Input
                                            className="w-28 font-mono text-xs"
                                            value={t.attrKey ?? ""}
                                            onChange={(e) => updateAt(i, { attrKey: e.target.value || null })}
                                            placeholder="attr key"
                                            title="Key in attrsJson (e.g. color, storage, os)"
                                        />
                                    )}
                                    <Input
                                        className="max-w-[120px]"
                                        value={t.defaultValue ?? ""}
                                        onChange={(e) => updateAt(i, { defaultValue: e.target.value || null })}
                                        placeholder="default if empty"
                                    />
                                </>
                            ) : (
                                <Input
                                    className="max-w-[160px]"
                                    value={t.defaultValue ?? ""}
                                    onChange={(e) => updateAt(i, { defaultValue: e.target.value || null })}
                                    placeholder="default if empty"
                                />
                            )}
                            <Input
                                className="w-20 font-mono text-xs"
                                value={t.suffix ?? ""}
                                onChange={(e) => updateAt(i, { suffix: e.target.value || null })}
                                placeholder="suffix"
                                title="Suffix — appended after this token's value"
                            />
                            <Button type="button" variant="outline" size="icon-sm" aria-label="Remove" onClick={() => removeAt(i)}>
                                <Trash2 className="size-4" />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
                <Select value={pendingKind || "__add__"} onValueChange={(v) => setPendingKind(v === "__add__" ? "" : (v as TokenKind))}>
                    <SelectTrigger className="w-48">
                        <SelectValue placeholder="Add token…" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="__add__">Add token…</SelectItem>
                        {canAdd.map((k) => (
                            <SelectItem key={k} value={k}>{TOKEN_LABEL[k]}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={addToken} disabled={!pendingKind}>
                    <Plus className="size-4" />
                    Add
                </Button>
            </div>
        </div>
    );
}

function FallbackEditor({ value, onChange }: { value: FallbackMap; onChange: (v: FallbackMap) => void }) {
    const editable: TokenKind[] = ["brand", "category", "group"];
    return (
        <div className="space-y-2">
            {editable.map((k) => {
                const chain = value[k] ?? [];
                const choices = ALL_KINDS.filter((c) => c !== k);
                return (
                    <div key={k} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-[110px] text-sm font-medium">When {TOKEN_LABEL[k]} empty:</span>
                        {[0, 1, 2].map((slot) => (
                            <Select
                                key={slot}
                                value={chain[slot] ?? "__none__"}
                                onValueChange={(v) => {
                                    const next = chain.slice();
                                    if (v === "__none__") {
                                        next.splice(slot, next.length - slot);
                                    } else {
                                        next[slot] = v as TokenKind;
                                    }
                                    onChange({ ...value, [k]: next });
                                }}
                            >
                                <SelectTrigger className="w-40">
                                    <SelectValue placeholder="—" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">— none —</SelectItem>
                                    {choices.map((c) => (
                                        <SelectItem key={c} value={c}>{TOKEN_LABEL[c]}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}

export default function NamingConventionPage() {
    const [cfg, setCfg] = useState<NamingConfigShape>(DEFAULT_NAMING_CONFIG);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [attrKeys, setAttrKeys] = useState<Array<{ key: string; name: string }>>([]);

    useEffect(() => {
        Promise.all([
            axios
                .get<NamingConfigShape>("/api/inventory/naming-config")
                .then((r) => setCfg({ ...DEFAULT_NAMING_CONFIG, ...r.data })),
            axios
                .get<Array<{ key: string; name: string; isActive: boolean }>>("/api/inventory/attribute-masters")
                .then((r) => {
                    const seen = new Set<string>();
                    setAttrKeys(
                        r.data
                            .filter((m) => m.isActive)
                            .filter((m) => { if (seen.has(m.key)) return false; seen.add(m.key); return true; }),
                    );
                }),
        ])
            .catch(() => toast.error("Failed to load naming config"))
            .finally(() => setLoading(false));
    }, []);

    const offlinePreview = useMemo(() => buildOfflineName(PREVIEW_MASTERS, cfg), [cfg]);
    const onlinePreview = useMemo(() => buildOnlineName(PREVIEW_MASTERS, cfg), [cfg]);
    const slugPreview = useMemo(() => buildOnlineSlug(PREVIEW_MASTERS, cfg), [cfg]);

    const save = async () => {
        setSaving(true);
        try {
            const payload = {
                nameFields: cfg.nameFields,
                separator: cfg.separator,
                onlineNameFields: cfg.onlineNameFields,
                onlineSeparator: cfg.onlineSeparator,
                slugFields: cfg.slugFields,
                slugSeparator: cfg.slugSeparator,
                slugEnabled: cfg.slugEnabled,
                slugMaxLength: cfg.slugMaxLength,
                fallbackFields: cfg.fallbackFields,
            };
            await axios.put("/api/inventory/naming-config", payload);
            toast.success("Naming convention saved");
        } catch (e: unknown) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <p className="text-sm text-muted-foreground">Loading…</p>;
    }

    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 px-6 pt-3 pb-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                    <Wand2 className="size-5" aria-hidden />
                    Product naming convention
                </h2>
                <Button type="button" onClick={save} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                </Button>
            </div>

            <p className="text-sm text-muted-foreground">
                Configure how product Name, Online display name, and URL slug are auto-generated from the masters
                (brand / category / group / model / warranty) on the product form. Three independent token lists share
                one fallback chain. Each token can carry a default value used when its source — and the fallback
                chain — are all empty.
            </p>

            <section className="space-y-3 border-2 border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-end gap-4">
                    <div>
                        <p className="text-sm font-semibold">Offline name</p>
                        <p className="text-xs text-muted-foreground">Staff-facing — vouchers, stock reports, POS.</p>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Separator</Label>
                        <Input className="w-24 font-mono" value={cfg.separator} onChange={(e) => setCfg({ ...cfg, separator: e.target.value })} />
                    </div>
                </div>
                <TokenListEditor
                    tokens={cfg.nameFields}
                    onChange={(t) => setCfg({ ...cfg, nameFields: t })}
                    available={ALL_KINDS}
                    attrKeys={attrKeys}
                />
                <div className="border border-dashed border-border bg-background p-2 font-mono text-sm">
                    Preview: <span className="font-semibold">{offlinePreview || <em className="text-muted-foreground">(empty)</em>}</span>
                </div>
            </section>

            <section className="space-y-3 border-2 border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-end gap-4">
                    <div>
                        <p className="text-sm font-semibold">Online display name</p>
                        <p className="text-xs text-muted-foreground">Storefront — SEO-rich; aim for 50–65 chars.</p>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Separator</Label>
                        <Input className="w-24 font-mono" value={cfg.onlineSeparator} onChange={(e) => setCfg({ ...cfg, onlineSeparator: e.target.value })} />
                    </div>
                </div>
                <TokenListEditor
                    tokens={cfg.onlineNameFields}
                    onChange={(t) => setCfg({ ...cfg, onlineNameFields: t })}
                    available={ALL_KINDS}
                    attrKeys={attrKeys}
                />
                <div className="border border-dashed border-border bg-background p-2 font-mono text-sm">
                    Preview: <span className="font-semibold">{onlinePreview || <em className="text-muted-foreground">(empty)</em>}</span>
                </div>
            </section>

            <section className="space-y-3 border-2 border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-end gap-4">
                    <div>
                        <p className="text-sm font-semibold">Online slug</p>
                        <p className="text-xs text-muted-foreground">URL handle for /shop/product/&lt;slug&gt;.</p>
                    </div>
                    <label className="flex items-center gap-2 pb-2 text-sm">
                        <input type="checkbox" checked={cfg.slugEnabled} onChange={(e) => setCfg({ ...cfg, slugEnabled: e.target.checked })} />
                        Enabled
                    </label>
                    <div className="space-y-1">
                        <Label className="text-xs">Separator</Label>
                        <Input className="w-24 font-mono" value={cfg.slugSeparator} onChange={(e) => setCfg({ ...cfg, slugSeparator: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Max length</Label>
                        <Input
                            type="text" inputMode="numeric"
                            className="w-24"
                            value={cfg.slugMaxLength}
                            onChange={(e) => setCfg({ ...cfg, slugMaxLength: Number(e.target.value) || 0 })}
                        />
                    </div>
                </div>
                <TokenListEditor
                    tokens={cfg.slugFields}
                    onChange={(t) => setCfg({ ...cfg, slugFields: t })}
                    available={ALL_KINDS}
                    attrKeys={attrKeys}
                />
                <div className="border border-dashed border-border bg-background p-2 font-mono text-sm">
                    Preview: <span className="font-semibold">{slugPreview || <em className="text-muted-foreground">(disabled or empty)</em>}</span>
                </div>
            </section>

            <section className="space-y-3 border-2 border-border bg-muted/30 p-4">
                <div>
                    <p className="text-sm font-semibold">Fallback chain (shared)</p>
                    <p className="text-xs text-muted-foreground">
                        When a token&apos;s source field is empty on a product, walk this chain. If the chain is also
                        empty, the token&apos;s own default value (if set) is used; otherwise the token is skipped.
                    </p>
                </div>
                <FallbackEditor value={cfg.fallbackFields} onChange={(v) => setCfg({ ...cfg, fallbackFields: v })} />
            </section>

            <div className="flex justify-end">
                <Button type="button" onClick={save} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                </Button>
            </div>
        </div>
        </ScrollArea>
    );
}
