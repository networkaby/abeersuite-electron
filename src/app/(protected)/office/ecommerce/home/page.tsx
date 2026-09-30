"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ChevronDown, ChevronUp, Copy, ExternalLink, Trash2, Plus, Maximize2, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseDigitsInput, parseSignedInput } from "@/shared/lib/format";
import { cn } from "@/shared/lib/format/utils";
import {
    DEFAULT_HOME_INSTANCES,
    HOME_SECTION_TYPE_DEFS,
    RAIL_KINDS,
    homeSectionTypeDef,
    isFallbackInstance,
    isInstanceActive,
    newHomeInstance,
    resolveHomeSections,
    type HomeSectionInstance,
    type HomeSectionType,
    type RailKind,
} from "@/shared/lib/shop/homeLayout";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { DEFAULT_TRUST_ITEMS } from "@/modules/external/store/TrustStrip";
import type { BrandStripBrand } from "@/modules/external/store/BrandStripView";
import SectionPreview, { type PreviewData } from "@/modules/ecommerce/components/homeEditor/SectionPreview";
import BannerSlidesEditor from "@/modules/ecommerce/components/homeEditor/BannerSlidesEditor";
import TrustItemsEditor from "@/modules/ecommerce/components/homeEditor/TrustItemsEditor";
import HeadingEditor from "@/modules/ecommerce/components/homeEditor/HeadingEditor";
import { getWithRetry } from "@/shared/lib/http/getWithRetry";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { confirmAction } from "@/shared/lib/ui/confirmStore";

// Per-type placeholder text for "heading" kind instances — the text a blank
// field falls back to, i.e. what the component's own hardcoded default says.
const HEADING_FIELDS: Partial<Record<HomeSectionType, ("eyebrow" | "title" | "subtitle")[]>> = {
    categoryShowcase: ["eyebrow", "title", "subtitle"],
    dealOfTheDay: ["eyebrow", "title"],
    brandStrip: ["eyebrow", "title"],
    fullCatalog: ["title"],
};
const HEADING_PLACEHOLDERS: Partial<Record<HomeSectionType, { eyebrow?: string; title?: string; subtitle?: string }>> = {
    categoryShowcase: {
        eyebrow: "Departments",
        title: "Shop by category",
        subtitle: "Tap a department to jump to its section in the catalog below.",
    },
    dealOfTheDay: { eyebrow: "Deal of the day", title: "Biggest savings — limited stock" },
    brandStrip: { eyebrow: "Trusted brands", title: "Original products from leading manufacturers" },
    fullCatalog: { title: "Catalog" },
};

function sortForDisplay(rows: HomeSectionInstance[]): HomeSectionInstance[] {
    return [...rows].sort((a, b) => a.sectionNo - b.sectionNo || b.priority - a.priority);
}

/**
 * Buffered numeric text input — same pattern as the print-template settings
 * page's NumberField: type freely, commit on blur. Per repo rule, never
 * `<input type="number">` (breaks on paste, spinner steals scroll, silently
 * clamps mid-edit) — plain text + inputMode + a sanitizer instead.
 */
function BufferedIntField({
    value,
    onCommit,
    allowNegative,
    className,
    disabled,
    "aria-label": ariaLabel,
}: {
    value: number;
    onCommit: (n: number) => void;
    allowNegative?: boolean;
    className?: string;
    disabled?: boolean;
    "aria-label"?: string;
}) {
    const [text, setText] = useState(String(value));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => setText(String(value)), [value]);
    const sanitize = allowNegative ? parseSignedInput : parseDigitsInput;
    return (
        <Input
            inputMode={allowNegative ? "text" : "numeric"}
            value={text}
            onChange={(e) => setText(sanitize(e.target.value))}
            onBlur={() => {
                const n = parseInt(text, 10);
                const next = Number.isNaN(n) ? value : n;
                setText(String(next));
                if (next !== value) onCommit(next);
            }}
            className={className}
            disabled={disabled}
            aria-label={ariaLabel}
        />
    );
}

/**
 * One-line summary in the row, just enough to tell near-identical sections
 * apart. The real visual is the right-hand LIVE PREVIEW panel — a squeezed
 * thumbnail here was unreadable.
 */
function InstanceSummary({ inst }: { inst: HomeSectionInstance }) {
    const kind = homeSectionTypeDef(inst.type).kind;
    if (kind === "banner") {
        const slides = inst.content.slides ?? [];
        const noun = inst.type === "hero" ? "slide" : "banner";
        if (slides.length === 0) {
            return <span className="truncate text-xs text-muted-foreground">No {noun}s yet</span>;
        }
        return (
            <span className="truncate text-xs text-muted-foreground">
                {slides.length} {noun}
                {slides.length === 1 ? "" : "s"} · {slides[0].title || "(untitled)"}
            </span>
        );
    }
    if (kind === "trust") {
        return (
            <span className="truncate text-xs text-muted-foreground">
                {inst.content.items?.length ?? DEFAULT_TRUST_ITEMS.length} items
            </span>
        );
    }
    if (kind === "productRail") {
        const rk = RAIL_KINDS.find((r) => r.value === inst.content.railKind);
        return <span className="truncate text-xs text-muted-foreground">{rk ? rk.label : "Pick a rule"}</span>;
    }
    if (kind === "stub") {
        return <span className="text-xs text-muted-foreground">Not wired up yet</span>;
    }
    const placeholder = HEADING_PLACEHOLDERS[inst.type];
    return (
        <span className="truncate text-xs text-muted-foreground">
            {inst.content.title || placeholder?.title || "Live catalogue data"}
        </span>
    );
}

/**
 * Scaled preview frame — same idea as the print-template settings page's
 * ScaledPreviewBox: storefront sections are built for a ~1280px page, so CSS
 * `zoom` shrinks the real component to fit the narrower preview column
 * without re-styling anything.
 */
const todayIso = new Date().toISOString().slice(0, 10);

function formatDateShort(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Date range + live/scheduled status, shown inline on each row. `renders`
 * tells us whether THIS instance is the one actually winning its sectionNo
 * slot right now — only one instance per sectionNo ever shows on the
 * storefront, so two "Active now" rows sharing a No. would be misleading;
 * the loser needs to say so.
 */
function ScheduleInfo({ inst, renders }: { inst: HomeSectionInstance; renders: boolean }) {
    if (isFallbackInstance(inst)) {
        return (
            <span
                className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    inst.enabled && renders
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                )}
            >
                {!inst.enabled ? "Fallback · switched off" : renders ? "Fallback · showing now" : "Fallback · on standby"}
            </span>
        );
    }
    const { startAt, endAt } = inst;
    const range = startAt || endAt
        ? `${startAt ? formatDateShort(startAt) : "Always"} → ${endAt ? formatDateShort(endAt) : "Always"}`
        : null;
    const active = inst.enabled && isInstanceActive(inst, todayIso);
    return (
        <span className="flex flex-wrap items-center gap-1.5">
            {range ? (
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    {range}
                </span>
            ) : null}
            {inst.enabled ? (
                <span
                    className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        renders
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground"
                    )}
                >
                    {renders ? "Active now" : active ? "Active window · overridden" : "Not active"}
                </span>
            ) : null}
        </span>
    );
}

function ScaledPreviewBox({ zoom, children }: { zoom: number; children: React.ReactNode }) {
    return (
        <div className="overflow-auto rounded-md border border-border bg-background">
            <div style={{ zoom }}>{children}</div>
        </div>
    );
}

function SectionRow({
    inst,
    renders,
    isSelected,
    isOpen,
    locked,
    onSelect,
    onDuplicate,
    onRemove,
    onUpdate,
    onSetSectionNo,
    onSetPriority,
    onToggleExpanded,
}: {
    inst: HomeSectionInstance;
    renders: boolean;
    isSelected: boolean;
    isOpen: boolean;
    locked?: boolean;
    onSelect: () => void;
    onDuplicate: () => void;
    onRemove: () => void;
    onUpdate: (patch: Partial<HomeSectionInstance>) => void;
    onSetSectionNo: (n: number) => void;
    onSetPriority: (n: number) => void;
    onToggleExpanded: () => void;
}) {
    const def = homeSectionTypeDef(inst.type);
    const fallback = isFallbackInstance(inst);
    return (
        <div
            onClick={onSelect}
            className={cn(
                "rounded-md border transition-colors",
                isSelected ? "border-primary ring-1 ring-primary/30" : "border-border hover:border-primary/40"
            )}
        >
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={onDuplicate}
                        aria-label={`Duplicate ${inst.label}`}
                        title="Duplicate"
                    >
                        <Copy className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive"
                        onClick={onRemove}
                        disabled={locked}
                        aria-label={`Delete ${inst.label}`}
                        title={locked ? "Locked — fallback sections can't be deleted" : "Delete"}
                    >
                        <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                </div>

                <div className="min-w-40 flex-1 space-y-0.5">
                    <Input
                        value={inst.label}
                        onChange={(e) => onUpdate({ label: e.target.value })}
                        disabled={locked}
                        className="h-7 border-transparent bg-transparent px-1 text-sm font-medium shadow-none hover:border-border focus-visible:border-border disabled:opacity-100"
                    />
                    <p className="px-1 text-[11px] text-muted-foreground">{def.label}</p>
                </div>

                <div className="hidden max-w-48 flex-1 shrink-0 items-center sm:flex">
                    <InstanceSummary inst={inst} />
                </div>

                <div className="hidden shrink-0 items-center md:flex">
                    <ScheduleInfo inst={inst} renders={renders} />
                </div>

                <div className="flex items-center gap-1">
                    <div className="grid gap-0.5">
                        <Label className="text-[10px] text-muted-foreground">No.</Label>
                        <BufferedIntField
                            value={inst.sectionNo}
                            onCommit={onSetSectionNo}
                            className="h-7 w-16"
                            aria-label={`${inst.label} section number`}
                            disabled={locked}
                        />
                    </div>
                    <div className="grid gap-0.5">
                        <Label className="text-[10px] text-muted-foreground">Priority</Label>
                        <BufferedIntField
                            value={inst.priority}
                            onCommit={onSetPriority}
                            allowNegative
                            className="h-7 w-16"
                            aria-label={`${inst.label} priority`}
                            disabled={locked}
                        />
                    </div>
                </div>

                <Switch
                    checked={inst.enabled}
                    onCheckedChange={(v) => onUpdate({ enabled: v })}
                    aria-label={`${inst.label} enabled`}
                    disabled={locked}
                />

                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={onToggleExpanded}
                    aria-label={isOpen ? "Collapse" : "Expand"}
                >
                    {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </Button>
            </div>

            {isOpen ? (
                <div className="space-y-3 border-t border-border px-3 py-3">
                    <div className="md:hidden">
                        <ScheduleInfo inst={inst} renders={renders} />
                    </div>
                    {fallback ? (
                        <p className="text-xs text-muted-foreground">
                            This is the permanent fallback for section No. {inst.sectionNo} — it renders whenever
                            nothing else in that slot is currently scheduled, regardless of any date range.{" "}
                            {locked
                                ? "It is locked so it isn't changed by mistake — Duplicate it to start a new version, or Unlock the fallbacks next to Full size (needs the Unlock fallback permission)."
                                : "Unlocked — every fallback locks again when you press Lock or Save layout."}
                        </p>
                    ) : (
                        <div className="grid grid-cols-2 gap-2 sm:w-64">
                            <div className="grid gap-1">
                                <Label className="text-xs font-normal">Show from</Label>
                                <TallyDateInput
                                    value={inst.startAt ?? ""}
                                    onValueChange={(iso) => onUpdate({ startAt: iso || undefined })}
                                />
                            </div>
                            <div className="grid gap-1">
                                <Label className="text-xs font-normal">Show until</Label>
                                <TallyDateInput
                                    monthMode="end"
                                    value={inst.endAt ?? ""}
                                    onValueChange={(iso) => onUpdate({ endAt: iso || undefined })}
                                />
                            </div>
                        </div>
                    )}
                    <fieldset disabled={locked} className={cn(locked && "pointer-events-none opacity-60")}>
                        <ContentEditor inst={inst} onChange={(content) => onUpdate({ content })} />
                    </fieldset>
                </div>
            ) : null}
        </div>
    );
}

function ContentEditor({ inst, onChange }: { inst: HomeSectionInstance; onChange: (content: HomeSectionInstance["content"]) => void }) {
    const kind = homeSectionTypeDef(inst.type).kind;
    if (kind === "banner") {
        return <BannerSlidesEditor content={inst.content} onChange={onChange} isHero={inst.type === "hero"} />;
    }
    if (kind === "trust") {
        return (
            <TrustItemsEditor
                items={inst.content.items}
                defaultItems={DEFAULT_TRUST_ITEMS}
                onChange={(items) => onChange({ ...inst.content, items: items ?? undefined })}
            />
        );
    }
    if (kind === "productRail") {
        return (
            <div className="space-y-2">
                <div className="grid gap-1">
                    <Label className="text-xs font-normal">Picking rule</Label>
                    <Select
                        value={inst.content.railKind ?? "featured"}
                        onValueChange={(v) => onChange({ ...inst.content, railKind: v as RailKind })}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {RAIL_KINDS.map((r) => (
                                <SelectItem key={r.value} value={r.value}>
                                    {r.label}
                                    {r.implemented ? "" : " — not wired yet"}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <HeadingEditor content={inst.content} onChange={onChange} fields={["eyebrow", "title", "subtitle"]} />
            </div>
        );
    }
    if (kind === "stub") {
        return (
            <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                    This section type isn&apos;t wired up to real data yet — you can schedule and position it now, but it
                    won&apos;t appear on the storefront until it&apos;s built.
                </p>
                <HeadingEditor content={inst.content} onChange={onChange} fields={["title"]} placeholders={{ title: "Caption" }} />
            </div>
        );
    }
    return (
        <HeadingEditor
            content={inst.content}
            onChange={onChange}
            fields={HEADING_FIELDS[inst.type] ?? ["title"]}
            placeholders={HEADING_PLACEHOLDERS[inst.type]}
        />
    );
}

export default function CustomizeHomePage() {
    const [instances, setInstances] = useState<HomeSectionInstance[]>(DEFAULT_HOME_INSTANCES);
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [saving, setSaving] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [addType, setAddType] = useState<HomeSectionType>("promoBanner");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [previewData, setPreviewData] = useState<PreviewData>({ products: [], brands: [] });
    const [fullSize, setFullSize] = useState(false);
    const [fallbackGroupOpen, setFallbackGroupOpen] = useState(false);
    // Every fallback opens and locks together. The Unlock button sits next to
    // Full size (never on a row, so a stray click can't flip it) and only for a
    // role holding the permission; they lock again on Lock or Save layout.
    const [fallbacksUnlocked, setFallbacksUnlocked] = useState(false);
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canUnlock = hasPermissionWithScope(permissions, PERMISSIONS.ECOMMERCE_FALLBACK_UNLOCK);

    const load = useCallback(async () => {
        setLoadError(false);
        try {
            const data = await getWithRetry<{ layout: HomeSectionInstance[] }>("/api/ecommerce/home-layout");
            setInstances(data.layout);
            setLoaded(true);
        } catch {
            setLoadError(true);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    // Real catalogue data for the preview — the same published-products payload
    // the storefront itself renders from, so a previewed rail / category grid /
    // deal shows the actual products a customer would see. Failure is
    // non-fatal: content-only sections (hero, banners, trust) still preview.
    useEffect(() => {
        void (async () => {
            const [products, brands] = await Promise.all([
                axios
                    .get<ShopProductPublic[]>("/api/shop/products")
                    .then((r) => r.data)
                    .catch(() => [] as ShopProductPublic[]),
                axios
                    .get<BrandStripBrand[]>("/api/inventory/brands?withProducts=1")
                    .then((r) => r.data.filter((b) => b.imageUrl))
                    .catch(() => [] as BrandStripBrand[]),
            ]);
            setPreviewData({ products, brands });
        })();
    }, []);

    const updateInstance = (id: string, patch: Partial<HomeSectionInstance>) => {
        setInstances((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    };

    // Priority -1 means "this instance IS the fallback" — only one per
    // sectionNo group is meaningful, so block setting a second one instead of
    // silently leaving an ambiguous pair (resolveGroup only trusts the first
    // match it finds, which would be confusing to depend on here).
    // Within one sectionNo group, priority is the tie-breaker — two instances
    // sharing both the same No. AND the same priority makes the winner
    // ambiguous (resolveGroup would just pick whichever array order won),
    // so it's blocked outright rather than left to silently depend on that.
    const setPriority = (id: string, next: number) => {
        // Making a fallback is changing the fallbacks, so it needs them unlocked —
        // otherwise the row would drop into the locked group with no way back out.
        if (next === -1 && !fallbacksUnlocked) {
            toast.error(
                canUnlock
                    ? "Unlock the fallbacks first (next to Full size) to make a new one."
                    : "Only a role with the Unlock fallback permission can make a fallback."
            );
            return;
        }
        const inst = instances.find((i) => i.id === id);
        const clash = inst && instances.some(
            (i) => i.id !== id && i.sectionNo === inst.sectionNo && i.priority === next
        );
        if (clash) {
            toast.error(
                next === -1
                    ? "This section number already has a fallback. Only one fallback per section number."
                    : "This section number already has a section with that priority. Use a different priority."
            );
            return;
        }
        updateInstance(id, { priority: next });
    };

    // Same guard, the other direction: moving an instance into a section
    // number that already has one at the same priority.
    const setSectionNo = (id: string, next: number) => {
        const inst = instances.find((i) => i.id === id);
        const clash = inst && instances.some((i) => i.id !== id && i.sectionNo === next && i.priority === inst.priority);
        if (clash) {
            toast.error(
                inst!.priority === -1
                    ? "This section number already has a fallback. Only one fallback per section number."
                    : "This section number already has a section with that priority. Use a different priority."
            );
            return;
        }
        updateInstance(id, { sectionNo: next });
    };

    const removeInstance = (id: string) => {
        setInstances((prev) => prev.filter((i) => i.id !== id));
        setSelectedId((cur) => (cur === id ? null : cur));
        setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    const duplicateInstance = (id: string) => {
        const src = instances.find((i) => i.id === id);
        if (!src) return;
        // A copy stays in its source's slot and can't share both sectionNo and
        // priority with anything there (blocked as an ambiguous tie), so it takes
        // the next free priority. A fallback's copy is an ordinary section
        // (priority from 0, the fallback's ignored dates dropped) and starts
        // switched off: with no dates it would otherwise win its slot every day,
        // so copying alone never changes the storefront.
        const fromFallback = isFallbackInstance(src);
        let priority = fromFallback ? 0 : src.priority;
        const used = new Set(instances.filter((i) => i.sectionNo === src.sectionNo).map((i) => i.priority));
        while (used.has(priority)) priority += 1;
        const clone: HomeSectionInstance = {
            ...src,
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            label: `${src.label} (copy)`,
            priority,
            ...(fromFallback ? { enabled: false, startAt: undefined, endAt: undefined } : {}),
        };
        setInstances((prev) => [...prev, clone]);
        if (fromFallback) toast.success("Copy added above, switched off — edit it, then switch it on.");
    };

    const toggleFallbackLock = async () => {
        if (fallbacksUnlocked) {
            setFallbacksUnlocked(false);
            return;
        }
        const count = instances.filter(isFallbackInstance).length;
        const ok = await confirmAction({
            title: `Unlock all ${count} fallback section${count === 1 ? "" : "s"}?`,
            body: "Fallbacks are what the storefront shows in a slot whenever nothing else there is scheduled. They stay open until you press Lock or Save layout, and nothing changes on the storefront until you save.",
            confirmLabel: "Unlock",
            destructive: false,
        });
        if (!ok) return;
        setFallbacksUnlocked(true);
        setFallbackGroupOpen(true);
    };

    const addSection = () => {
        const nextNo = instances.length > 0 ? Math.max(...instances.map((i) => i.sectionNo)) + 10 : 10;
        const inst = newHomeInstance(addType, nextNo);
        setInstances((prev) => [...prev, inst]);
        setExpanded((prev) => new Set(prev).add(inst.id));
        setSelectedId(inst.id);
    };

    const toggleExpanded = (id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const save = async () => {
        setSaving(true);
        try {
            const { data } = await axios.put<{ layout: HomeSectionInstance[] }>("/api/ecommerce/home-layout", instances);
            setInstances(data.layout);
            setFallbacksUnlocked(false);
            toast.success("Home page layout saved");
        } catch {
            toast.error("Failed to save layout");
        } finally {
            setSaving(false);
        }
    };

    const allRows = sortForDisplay(instances);
    const normalRows = allRows.filter((i) => !isFallbackInstance(i));
    const fallbackRows = allRows.filter(isFallbackInstance);
    const selected = instances.find((i) => i.id === selectedId) ?? null;
    // Which instance actually wins each sectionNo slot right now — only one
    // renders per slot, so every row's "Active now" badge must be measured
    // against this, not its own schedule in isolation.
    const winnerIds = new Set(resolveHomeSections(instances, todayIso).map((i) => i.id));

    // Card header toolbar — the page itself never scrolls (only the section
    // list does), so one bar at the top stays reachable at all times.
    const toolbar = (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
                <Select value={addType} onValueChange={(v) => setAddType(v as HomeSectionType)}>
                    <SelectTrigger className="w-56">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {HOME_SECTION_TYPE_DEFS.map((d) => (
                            <SelectItem key={d.type} value={d.type}>
                                {d.label}
                                {d.implemented ? "" : " — not wired yet"}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="sm" onClick={addSection} disabled={!loaded}>
                    <Plus className="mr-1.5 size-3.5" /> Add section
                </Button>
            </div>

            <div className="flex items-center gap-3">
                {!loaded ? <span className="text-xs text-muted-foreground">Loading…</span> : null}
                {/* The real shop website, not "/": the desktop app has no shop pages,
                    and an outside address opens in the computer's own browser. */}
                <Button variant="outline" size="sm" asChild>
                    <Link href={COMPANY_DETAILS.sites.shop} target="_blank" rel="noopener noreferrer">
                        View storefront
                        <ExternalLink className="ml-1.5 size-3.5" aria-hidden />
                    </Link>
                </Button>
                <Button type="button" onClick={() => void save()} disabled={!loaded || saving}>
                    {saving ? "Saving…" : "Save layout"}
                </Button>
            </div>
        </div>
    );

    return (
        // <div className="mx-auto max-w-3xl space-y-4">
        <div className="mx-auto flex h-full w-full items-stretch gap-4 overflow-hidden">
            {/* <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight">Customize home</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Add, duplicate, schedule and prioritise storefront home page sections. Page order follows
                        Section No.; when two sections share a number, the highest Priority that's currently in its
                        date window wins. Changes apply to <span className="font-medium">/</span> for every customer.
                    </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                    <Link href="/" target="_blank" rel="noopener noreferrer">
                        View storefront
                        <ExternalLink className="ml-1.5 size-3.5" aria-hidden />
                    </Link>
                </Button>
            </div> */}
            <div className="flex min-w-0 flex-1 flex-col">
                <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
                    <CardHeader className="gap-2 border-b border-border px-4 py-3">
                        <CardTitle className="text-base">Sections</CardTitle>
                        {!loadError ? toolbar : null}
                    </CardHeader>
                    <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
                        {loadError ? (
                            <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
                                <span className="text-destructive">Couldn&apos;t load the current layout.</span>
                                <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                                    Retry
                                </Button>
                            </div>
                        ) : (
                            <>
                                {normalRows.map((inst) => (
                                    <SectionRow
                                        key={inst.id}
                                        inst={inst}
                                        renders={winnerIds.has(inst.id)}
                                        isSelected={selectedId === inst.id}
                                        isOpen={expanded.has(inst.id)}
                                        onSelect={() => setSelectedId(inst.id)}
                                        onDuplicate={() => duplicateInstance(inst.id)}
                                        onRemove={() => removeInstance(inst.id)}
                                        onUpdate={(patch) => updateInstance(inst.id, patch)}
                                        onSetSectionNo={(n) => setSectionNo(inst.id, n)}
                                        onSetPriority={(n) => setPriority(inst.id, n)}
                                        onToggleExpanded={() => toggleExpanded(inst.id)}
                                    />
                                ))}

                                <div className="pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setFallbackGroupOpen((v) => !v)}
                                        className="flex w-full items-center justify-between gap-2 rounded-md px-1 pb-2 text-left"
                                        aria-expanded={fallbackGroupOpen}
                                    >
                                        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                                            Fallback sections
                                            <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">
                                                {fallbacksUnlocked
                                                    ? "(unlocked · Lock next to Full size)"
                                                    : canUnlock
                                                      ? "(locked · Unlock next to Full size)"
                                                      : "(locked)"}
                                            </span>
                                        </span>
                                        {fallbackGroupOpen ? (
                                            <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                        ) : (
                                            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                        )}
                                    </button>
                                    {fallbackGroupOpen ? (
                                        fallbackRows.length === 0 ? (
                                            <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
                                                No fallback set. Set a section&apos;s priority to -1 to make it the permanent
                                                fallback for its section number.
                                            </p>
                                        ) : (
                                            <div className="space-y-2">
                                                {fallbackRows.map((inst) => (
                                                    <SectionRow
                                                        key={inst.id}
                                                        inst={inst}
                                                        renders={winnerIds.has(inst.id)}
                                                        isSelected={selectedId === inst.id}
                                                        isOpen={expanded.has(inst.id)}
                                                        locked={!fallbacksUnlocked}
                                                        onSelect={() => setSelectedId(inst.id)}
                                                        onDuplicate={() => duplicateInstance(inst.id)}
                                                        onRemove={() => removeInstance(inst.id)}
                                                        onUpdate={(patch) => updateInstance(inst.id, patch)}
                                                        onSetSectionNo={(n) => setSectionNo(inst.id, n)}
                                                        onSetPriority={(n) => setPriority(inst.id, n)}
                                                        onToggleExpanded={() => toggleExpanded(inst.id)}
                                                    />
                                                ))}
                                            </div>
                                        )
                                    ) : null}
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>
            {/* LIVE PREVIEW — renders the selected section exactly as the
                storefront would, whatever its on/off or schedule state, so a
                seasonal or switched-off section can be designed here instead
                of being experimented with on the live site. */}
            <div className="hidden w-[41rem] shrink-0 xl:flex xl:flex-col">
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <div className="flex shrink-0 items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                            Live preview
                        </p>
                        <div className="flex items-center gap-2">
                            {canUnlock && fallbackRows.length > 0 ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void toggleFallbackLock()}
                                    title={fallbacksUnlocked ? "Lock every fallback section" : "Unlock every fallback section"}
                                >
                                    {fallbacksUnlocked ? (
                                        <>
                                            <Lock className="mr-1.5 size-3.5" aria-hidden /> Lock
                                        </>
                                    ) : (
                                        <>
                                            <LockOpen className="mr-1.5 size-3.5" aria-hidden /> Unlock
                                        </>
                                    )}
                                </Button>
                            ) : null}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!selected}
                                onClick={() => setFullSize(true)}
                            >
                                <Maximize2 className="mr-1.5 size-3.5" aria-hidden /> Full size
                            </Button>
                        </div>
                    </div>

                    {selected ? (
                        <>
                            <p className="shrink-0 truncate text-sm font-medium">
                                {selected.label}
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    {homeSectionTypeDef(selected.type).label}
                                    {selected.enabled ? "" : " · switched off"}
                                    {selected.startAt || selected.endAt ? " · scheduled" : ""}
                                </span>
                            </p>
                            <div className="min-h-0 flex-1 overflow-auto">
                                <ScaledPreviewBox zoom={0.55}>
                                    <SectionPreview inst={selected} data={previewData} />
                                </ScaledPreviewBox>
                            </div>
                        </>
                    ) : (
                        <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                            Select a section on the left to preview it.
                        </div>
                    )}
                </div>
            </div>

            {/* Full-size popup — same section at native storefront width. */}
            <Dialog open={fullSize} onOpenChange={setFullSize}>
                <DialogContent className="max-w-[95vw] sm:max-w-[95vw]">
                    <DialogHeader>
                        <DialogTitle>{selected ? selected.label : "Preview"}</DialogTitle>
                    </DialogHeader>
                    <div className="max-h-[80vh] overflow-auto rounded-md border border-border bg-background">
                        {selected ? <SectionPreview inst={selected} data={previewData} /> : null}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
