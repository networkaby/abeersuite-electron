"use client";

import { useCallback, useEffect, useRef, useState, useEffectEvent } from "react";
import { GatedLink } from "@/shared/components/GatedLink";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ShopProductAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { productShopUrl, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import ProductGalleryUploader from "@/modules/ecommerce/components/ProductGalleryUploader";
import ProductVariantsSection from "@/modules/inventory/components/ProductVariantsSection";
import AiCopyPanel from "@/modules/ecommerce/components/AiCopyPanel";
import type { ProductCopy } from "@/modules/ecommerce/lib/aiCopyClient";
import { PhotoChecklistRows } from "@/modules/ecommerce/components/AiPhotoPicker";
import { isEnough, type PhotoChecklist, type PhotoKind } from "@/modules/ecommerce/lib/photoChecklist";
import ProductCard from "@/modules/external/shop/ProductCard";
import {
    shopQualification,
    DEFAULT_SHOP_PUBLISH_RULES,
    type ShopPublishRules,
} from "@/modules/ecommerce/lib/shopQualification";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { Check, ExternalLink, RefreshCw, X } from "lucide-react";
import type { ProductNaming } from "@/modules/inventory/lib/regenerateNames";
import { useValueChange } from "@/shared/hooks/useValueChange";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import { MultiSelectChips, SearchableMultiSelect } from "@/shared/components/SearchableMultiSelect";
import { InventoryMasterDropdownQuickDialog } from "@/modules/inventory/components/InventoryMasterDropdownQuickDialog";
import { treeSelectOptions } from "@/shared/lib/tree";
import { syncMasters, invalidateMasters, type Masters } from "@/shared/lib/inventory";
import { useSession } from "next-auth/react";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { AttentionDialog } from "@/modules/ecommerce/components/AttentionDialog";


const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((u, i) => u === b[i]);

/** "Never seen" for useValueChange, so the form also seeds on its first render. */
const NOT_SEEN = Symbol("not seen");
export default function ProductForm({
    initial,
    onSaved,
    onReload,
    submitLabel = "Save product",
    onNameChange,
    onClose,
    onDirtyChange,
}: {
    /** Shows a Close button in the save bar (asks first when there are unsaved changes). */
    onClose?: () => void;
    /** Told whenever the form gains / loses unsaved changes. */
    onDirtyChange?: (dirty: boolean) => void;
    initial?: Partial<ShopProductAdmin> | null;
    onSaved?: (p: ShopProductAdmin) => void;
    /** The row was changed outside a save (Flag attention) — take it without a "Saved" note. Falls back to onSaved. */
    onReload?: (p: ShopProductAdmin) => void;
    submitLabel?: string;
    /** A saved product's Name is shown by the page header, not a box here —
     *  told the unsaved rebuilt name when Group / Brand change it. */
    onNameChange?: (name: string) => void;
}) {
    // inventory fields
    const [sku, setSku] = useState(initial?.sku ?? "");
    const [name, setName] = useState(initial?.name ?? "");
    // shop fields
    const [slug, setSlug] = useState(initial?.slug ?? "");
    // Online display name — manual, no naming-convention regen. Auto-filled from
    // Name so the operator has something to override rather than typing from
    // scratch; once they edit it directly it stops following Name. Falls back to
    // Name on the storefront whenever it's left blank.
    const [subheading, setSubheading] = useState(initial?.subheading ?? initial?.name ?? "");
    const subheadingTouched = useRef(!!initial?.subheading);
    // Group + brand are the inventory masters themselves (no shop-only copy):
    // the storefront shows the group as the product's Category. Changing them
    // here needs Deep edit (or Inventory products:edit), checked again by the PATCH route.
    const [groupId, setGroupId] = useState<number | null>(initial?.groupId ?? null);
    const [brandId, setBrandId] = useState<number | null>(initial?.brandId ?? null);
    // Collections — shop / marketing only, main first (productCollections.ts).
    const [collectionIds, setCollectionIds] = useState<number[]>(initial?.collectionIds ?? []);
    const { data: session } = useSession();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canEditMasters =
        hasPermissionWithScope(perms, PERMISSIONS.PRODUCTS_EDIT) ||
        hasPermissionWithScope(perms, PERMISSIONS.ECOMMERCE_PRODUCT_DEEP_EDIT);
    // Attention stage (owner, 2026-11-11): a Draft parked until something is
    // checked by hand. The reason shows above the save buttons (also after Save
    // as draft, until Save as ready); Flag attention parks it from here — anyone
    // who can save the product may flag it (owner, 2026-11-14).
    const attention = initial?.shopAttention ?? null;
    const [flagOpen, setFlagOpen] = useState(false);
    /** Reload the saved row after it was parked (Flag attention, or an AI clash) — stage and buttons read Attention. */
    const reloadRow = async () => {
        if (!initial?.id) return;
        try {
            const res = await axios.get<ShopProductAdmin>(`/api/ecommerce/products/${initial.id}`);
            (onReload ?? onSaved)?.(res.data);
        } catch { /* the list shows it on the next load */ }
    };
    // Replicated master lists — one delta request, usually "nothing changed".
    const [masters, setMasters] = useState<Masters | null>(null);
    useEffect(() => { void syncMasters().then((m) => { if (m) setMasters(m); }); }, []);
    const [masterKind, setMasterKind] = useState<"group" | "brand" | "category" | null>(null);
    const [gstRates, setGstRates] = useState<{ id: number; rate: string | number; label: string }[]>([]);
    // "+ New group/brand…" — resolves with the new row's id (null if cancelled)
    // so the dropdown selects it, the same contract as the inventory form.
    const masterResolve = useRef<((id: number | null) => void) | null>(null);
    const openCreateMaster = (kind: "group" | "brand" | "category") => new Promise<number | null>((resolve) => {
        if (kind === "group" && gstRates.length === 0) {
            axios.get("/api/inventory/gst-rates").then((r) => setGstRates(r.data)).catch(() => {});
        }
        masterResolve.current = resolve;
        setMasterKind(kind);
    });
    // Picking a group / brand rebuilds the Name from the naming convention
    // (server-side, with the unsaved pick). The Name is locked on this form, so
    // a pick is the operator's say-so and always rebuilds — even a product with
    // no Custom part (the grid's protect-hand-typed rule is for bulk edits).
    // Picking the saved group + brand again puts the saved name back exactly.
    // The online name follows while it is untyped or still a copy of the Name.
    const namingSeq = useRef(0);
    const pickMaster = (next: { groupId: number | null; brandId: number | null }) => {
        setGroupId(next.groupId);
        setBrandId(next.brandId);
        const productId = initial?.id;
        if (!productId) return;
        const seq = ++namingSeq.current;
        const applyName = (nm: string) => {
            setName(nm);
            onNameChange?.(nm);
            if (!subheadingTouched.current || subheading.trim() === name.trim()) setSubheading(nm);
        };
        if (next.groupId === (initial?.groupId ?? null) && next.brandId === (initial?.brandId ?? null)) {
            applyName(initial?.name ?? name);
            return;
        }
        axios
            .get<ProductNaming>(`/api/inventory/products/${productId}/naming`, {
                params: { groupId: next.groupId ?? "", brandId: next.brandId ?? "" },
            })
            .then(({ data }) => {
                if (seq !== namingSeq.current || !data.name) return;
                applyName(data.name);
            })
            .catch(() => { /* the name simply stays as it was */ });
    };
    const masterName = (rows: Masters[keyof Masters] | undefined, id: number | null, fallback?: string | null) =>
        id == null ? null : (rows?.find((r) => r.id === id)?.name as string | undefined) ?? fallback ?? null;
    const groupName = masterName(masters?.groups, groupId, initial?.groupName);
    const collectionOptions = treeSelectOptions(masters?.categories ?? []);
    const collectionNames = collectionIds
        .map((id) => masterName(masters?.categories, id))
        .filter((n): n is string => !!n);
    const brandName = masterName(masters?.brands, brandId, initial?.brandName);
    const [description, setDescription] = useState(initial?.description ?? "");
    // Price / MRP are deliberately NOT editable here. They are the SAME columns
    // (effectiveSalePricePaise / mrpPaise) that sale vouchers, POS lines and the
    // shelf label read — owned by the pricing-strategy engine, edited on the
    // pricing-strategy items page which also sets the override lock, enforces
    // the price ≤ MRP rule and re-materializes the price. A second editor here
    // could only get that wrong (write above MRP, clobber a fresh recompute,
    // then be silently reverted by the engine). Shown read-only below instead.
    const [badge, setBadge] = useState(initial?.badge ?? "");
    const [galleryUrls, setGalleryUrls] = useState<string[]>(initial?.galleryUrls ?? []);
    // Which gallery photo is selected in the uploader — lifted up so the live
    // preview card can show that photo, not just index 0.
    const [selectedImage, setSelectedImage] = useState(0);
    const [galleryStatus, setGalleryStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [photoChecklist, setPhotoChecklist] = useState<PhotoChecklist | null>(initial?.photoChecklist ?? initial?.shopDraft?.aiCopy?.photoChecklist ?? null);
    // The gallery exactly as last shown from the server (seeded, or the answer to
    // a save). Only a gallery that is a different list from this is a user edit
    // and autosaves — showing the server's copy never PATCHes it straight back.
    const [serverGallery, setServerGallery] = useState<string[]>(galleryUrls);
    const galleryDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gallerySeq = useRef(0);
    // The gallery as last saved on the server. Sent with every photo save so the
    // server merges this page's change onto the latest list (mergeGallery.ts) —
    // a photo added from the phone meanwhile is kept, not overwritten.
    const galleryBase = useRef<string[]>(initial?.galleryUrls ?? []);
    /** Show the server's gallery without it counting as an edit (no autosave). */
    const showServerGallery = useCallback((urls: string[]) => {
        galleryBase.current = urls;
        setGalleryUrls((cur) => (sameList(cur, urls) ? cur : urls));
        setServerGallery(urls);
        setSelectedImage((i) => (i < urls.length ? i : 0));
    }, []);
    const [specPairs, setSpecPairs] = useState<{ k: string; v: string }[]>(() => {
        const s = initial?.specs ?? {};
        const keys = Object.keys(s);
        if (keys.length === 0) return [{ k: "", v: "" }];
        return keys.map((k) => ({ k, v: s[k] ?? "" }));
    });
    // Stock is NOT editable here — InvProduct.stock is a cached ledger balance
    // (openingStock + Σ inQty − outQty), rebuilt by recomputeProductStock after
    // every voucher post / cancel / delete / restore. A manual write survives
    // only until the next voucher, so an input box here can only lie. Shown
    // read-only below; stock changes by posting an inventory voucher.
    const stockValue = initial?.stock ?? null;
    // Low-stock threshold is a REORDER input, not a shop field — nothing in the
    // storefront reads it. It is the manual floor in
    // max(avgDailyUsage × leadTimeDays, lowStockThreshold), and the Reorder page
    // edits it in context (it shows the computed reorder level beside the floor,
    // so you can see whether the floor is doing anything). Read-only here.
    const lowStockThresholdValue = initial?.lowStockThreshold ?? 5;
    const [weightGrams, setWeightGrams] = useState<string>(
        initial?.weightGrams == null ? "" : String(initial.weightGrams)
    );
    const dimStr = (v: number | null | undefined) => (v == null ? "" : String(v));
    const [lengthCm, setLengthCm] = useState<string>(dimStr(initial?.lengthCm));
    const [breadthCm, setBreadthCm] = useState<string>(dimStr(initial?.breadthCm));
    const [heightCm, setHeightCm] = useState<string>(dimStr(initial?.heightCm));
    const [allowBackorder, setAllowBackorder] = useState(initial?.allowBackorder ?? false);
    const [isActive, setIsActive] = useState(initial?.isActive ?? true);
    const [busy, setBusy] = useState(false);
    // The fields as last loaded — any change from this unlocks the Save buttons (null = take it next render).
    const [baseSig, setBaseSig] = useState<string | null>(null);
    // Owner-configured publish rules (which fields gate listing). Falls back to
    // the default gate until loaded.
    const [rules, setRules] = useState<ShopPublishRules>(DEFAULT_SHOP_PUBLISH_RULES);

    const loadRules = useCallback(() => {
        axios
            .get<{ rules: ShopPublishRules }>("/api/ecommerce/publish-rules")
            .then((r) => setRules(r.data.rules))
            .catch(() => setRules(DEFAULT_SHOP_PUBLISH_RULES));
    }, []);
    useEffect(loadRules, [loadRules]);
    // The publish rules are reference data — the form fields themselves never refresh under the editor.
    useRealtimeTopics(["catalogue"], loadRules);

    // Photos follow changes made elsewhere (the phone app, another office screen)
    // — only the photo block; the fields being typed in are never touched. Paused
    // while this page's own photo save is in flight, so it cannot undo it.
    const reloadGallery = useCallback(() => {
        const productId = initial?.id;
        if (!productId) return;
        const seq = gallerySeq.current;
        axios
            .get<ShopProductAdmin>(`/api/ecommerce/products/${productId}`)
            .then((r) => { if (gallerySeq.current === seq) showServerGallery(r.data.galleryUrls ?? []); })
            .catch(() => { /* the next signal or a reopen catches up */ });
    }, [initial?.id, showServerGallery]);
    useRealtimeTopics(["catalogue"], reloadGallery, !!initial?.id && galleryStatus !== "saving", ["InvProduct"]);

    // ── Naming convention (Settings → Naming Convention) ──────────────────
    // Slug is built from the product's masters (brand / group / model / …),
    // edited in Deep edit, not here — so this form asks the server what the
    // convention produces rather than re-deriving it client-side. The online
    // display name (subheading) is NOT part of this anymore: it's a manual
    // field, auto-filled from Name and freely overridable — see subheading
    // state above.
    const [regenBusy, setRegenBusy] = useState<null | "slug">(null);

    const fetchSlug = useCallback(
        (productId: number, silent: boolean) => axios
            .get<ProductNaming>(`/api/inventory/products/${productId}/naming`)
            .then(({ data }) => {
                if (data.slugEnabled && data.slug) {
                    setSlug(data.slug);
                    if (silent) toast.info("Masters changed — slug rebuilt. Review, then Save.");
                    else toast.success("Rebuilt slug from the naming convention");
                } else if (!silent) {
                    toast.error("Naming convention produced no slug for this product");
                }
            })
            .catch((e: unknown) => {
                if (!silent) toast.error(extractApiError(e, "Couldn't read the naming convention"));
            })
            .finally(() => setRegenBusy(null)),
        [],
    );
    const regenerate = useCallback(
        async (silent = false) => {
            const productId = initial?.id;
            if (!productId) return;
            setRegenBusy("slug");
            await fetchSlug(productId, silent);
        },
        [initial?.id, fetchSlug]
    );

    // Auto-rebuild the slug when a naming source actually changed — i.e. the
    // operator came back from Deep edit having swapped the brand / group /
    // warranty. The signature is compared across `initial` reloads, so an
    // unrelated refetch (saving price, photos) never rewrites the field.
    //
    // ONLY while the product is unpublished. Before listing, masters are still
    // being settled and a rebuilt slug costs nothing. Once it is live the slug
    // IS a public URL that customers and search engines hold — a brand edit must
    // not silently move it, so we stop auto-rebuilding and say so; the ⟳ button
    // still forces a rebuild when the operator genuinely wants one.
    const namingSig = [
        initial?.brandId, initial?.groupId, initial?.categoryId,
        initial?.warrantyTermId, initial?.unitId,
    ].join("|");
    const published = initial?.isListedInShop ?? false;

    // A naming source changed since the last `initial` (never on first render):
    // noted while rendering — the spinner shows at once — and acted on below.
    const [namingEvent, setNamingEvent] = useState<{ live: boolean } | null>(null);
    if (useValueChange(namingSig)) {
        setNamingEvent({ live: published });
        if (!published && initial?.id) setRegenBusy("slug");
    }
    const onNamingChanged = useEffectEvent((live: boolean) => {
        if (live) {
            toast.info("Masters changed. This product is live, so its slug was left alone — use ⟳ to rebuild it.");
            return;
        }
        if (initial?.id) void fetchSlug(initial.id, true);
    });
    useEffect(() => { if (namingEvent) onNamingChanged(namingEvent.live); }, [namingEvent]);

    // Seed the form from the server's copy whenever it arrives (also on mount, as
    // before) — while rendering, so the previous values never paint. The refs it
    // owns follow in the effect below.
    if (useValueChange<unknown>(initial, NOT_SEEN) && initial) {
        setSku(initial.sku ?? "");
        setName(initial.name ?? "");
        setSlug(initial.slug ?? "");
        setGroupId(initial.groupId ?? null);
        setBrandId(initial.brandId ?? null);
        setCollectionIds(initial.collectionIds ?? []);
        setSubheading(initial.subheading ?? initial.name ?? "");
        setDescription(initial.description ?? "");
        setBadge(initial.badge ?? "");
        setGalleryUrls(initial.galleryUrls ?? []);
        // The product's own checklist (our photo AI saves it, staff ticks update it), else
        // Claude's from the draft copy — the same Remove buttons either way.
        setPhotoChecklist(initial.photoChecklist ?? initial.shopDraft?.aiCopy?.photoChecklist ?? null);
        setSelectedImage(0);
        // Loading a product's own saved gallery is not a user edit — it becomes
        // the server copy, so the autosave does not re-PATCH it right back.
        setServerGallery(initial.galleryUrls ?? []);
        setGalleryStatus("idle");
        setWeightGrams(initial.weightGrams == null ? "" : String(initial.weightGrams));
        setLengthCm(dimStr(initial.lengthCm));
        setBreadthCm(dimStr(initial.breadthCm));
        setHeightCm(dimStr(initial.heightCm));
        setAllowBackorder(initial.allowBackorder ?? false);
        setIsActive(initial.isActive ?? true);
        setBaseSig(null);
    }
    useEffect(() => {
        if (!initial) return;
        subheadingTouched.current = !!initial.subheading;
        galleryBase.current = initial.galleryUrls ?? [];
    }, [initial]);

    // Autosave the photo block the moment it changes — add/remove/reorder/adjust/
    // make-primary all flow through `galleryUrls`, so one effect covers every
    // Photos action without each button wiring its own save call. Only fires for
    // an already-saved product (there's no id to PATCH until the first full Save).
    // Debounced so a burst of clicks (e.g. reordering twice) becomes one request.
    const galleryEdited = !sameList(galleryUrls, serverGallery);
    if (useValueChange(galleryUrls) && galleryEdited && initial?.id) setGalleryStatus("saving");
    useEffect(() => {
        if (!galleryEdited) return;
        const productId = initial?.id;
        if (!productId) return;

        if (galleryDebounce.current) clearTimeout(galleryDebounce.current);
        const seq = ++gallerySeq.current;
        galleryDebounce.current = setTimeout(() => {
            axios
                // Photos save onto the product at once, whatever the stage — a
                // Published product's photos change live (owner, 2026-11-10).
                .patch<ShopProductAdmin>(`/api/ecommerce/products/${productId}`, {
                    galleryUrls,
                    galleryBase: galleryBase.current,
                })
                .then((r) => {
                    if (gallerySeq.current !== seq) return;
                    setGalleryStatus("saved");
                    showServerGallery(r.data.galleryUrls ?? []);
                })
                .catch((e: unknown) => {
                    if (gallerySeq.current === seq) {
                        setGalleryStatus("error");
                        toast.error(extractApiError(e, "Couldn't save photos"));
                    }
                });
        }, 500);

        return () => {
            if (galleryDebounce.current) clearTimeout(galleryDebounce.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on gallery edits only, not every initial/id change
    }, [galleryUrls]);

    // Photo checklist saves at once, like the photos — it is about the gallery, not the form.
    const savePhotoChecklist = (next: PhotoChecklist) => {
        setPhotoChecklist(next);
        if (!initial?.id) return;
        axios.patch(`/api/ecommerce/products/${initial.id}`, { photoChecklist: next })
            .catch((e: unknown) => toast.error(extractApiError(e, "Couldn't save the photo checklist")));
    };
    const tickPhotoKinds = (kinds: PhotoKind[], flip = false) => {
        if (!photoChecklist) return;
        const items = photoChecklist.items.map((i) => (kinds.includes(i.kind) ? { ...i, done: flip ? !i.done : true } : i));
        savePhotoChecklist({ ...photoChecklist, items, enough: isEnough(items) });
    };

    // Shop price = the barcode tag the storefront actually charges (derived from
    // the saved sale price, server-side), falling back to the office effective
    // price while there's no saved price. Used for the live preview + readiness.
    // Read-only: price is decided on the pricing-strategy items page.
    const shopPricePaise = initial?.barcodePricePaise ?? initial?.pricePaise ?? 0;
    const effectiveMrpPaise = initial?.mrpPaise ?? null;

    // Sibling attributes this product still lacks (variant publish rule).
    const [selfGaps, setSelfGaps] = useState<string[]>(initial?.variantAttrGaps ?? []);
    const qualification = shopQualification(
        {
            pricePaise: shopPricePaise,
            imageUrl: galleryUrls[0] ?? null,
            galleryUrls,
            description: description.trim() || null,
            category: null,
            groupId,
            brandId,
            mrpPaise: effectiveMrpPaise,
            stock: stockValue,
            allowBackorder,
            weightGrams: weightGrams.trim() === "" ? null : parseInt(weightGrams, 10),
            // From the server, then kept current by the Variants table's edits.
            variantAttrGaps: selfGaps,
        },
        rules
    );
    const qualified = qualification.qualified;
    // Mark ready with a rule unmet is allowed — the toast says what publishing would wait for.
    const readyNote = qualified ? "" : `Marked ready — still needs ${qualification.missing.join(", ").toLowerCase()}, so publishing would wait as Pending`;
    // Stage: Unpublished → Draft → Ready → Published / Pending, one copy (owner, 2026-11-10).
    const shopStatus = initial?.shopStatus ?? "UNPUBLISHED";
    const aiDraft: ProductCopy | null = initial?.shopDraft?.aiCopy ?? null;
    const editSig = JSON.stringify([
        subheading, description, slug, badge, specPairs, weightGrams, lengthCm, breadthCm, heightCm,
        allowBackorder, isActive, groupId, brandId, collectionIds,
    ]);
    if (baseSig === null) setBaseSig(editSig);
    const dirty = baseSig !== null && editSig !== baseSig;
    // Any unsaved change: the Save buttons replace the stage buttons.
    const drafting = !!initial?.id && dirty;
    useEffect(() => {
        onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    // The live card always renders galleryUrls[0], so put the photo the user has
    // selected in the gallery first — preview only, the saved order is untouched.
    const previewGallery =
        selectedImage > 0 && selectedImage < galleryUrls.length
            ? [galleryUrls[selectedImage], ...galleryUrls.filter((_, i) => i !== selectedImage)]
            : galleryUrls;

    const previewProduct: ShopProductAdmin = {
        id: initial?.id ?? 0,
        shopAttention: attention,
        shopAttentionAt: initial?.shopAttentionAt ?? null,
        shopAttentionBy: initial?.shopAttentionBy ?? null,
        sku: sku.trim() || "SKU",
        slug: slug.trim() || null,
        name: name.trim() || "Product name",
        subheading: subheading.trim() || null,
        displayName: subheading.trim() || name.trim() || "Product name",
        description: description.trim() || null,
        category: groupName ?? "",
        // Live preview only — the office-side classification and the group chain
        // are not edited on this form, so the preview card carries neither.
        collection: collectionNames[0] ?? null,
        collections: collectionNames,
        department: null,
        categoryPath: [],
        // Edited in the Variants section, which saves on its own.
        variantFamilyId: initial?.variantFamilyId ?? null,
        brand: initial?.brand ?? null,
        attrs: initial?.attrs ?? {},
        pricePaise: shopPricePaise,
        mrpPaise: effectiveMrpPaise,
        badge: badge.trim() || null,
        imageUrl: previewGallery[0] ?? null,
        galleryUrls: previewGallery,
        specs: Object.fromEntries(specPairs.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v.trim()])),
        stock: stockValue,
        lowStockThreshold: lowStockThresholdValue,
        isListedInShop: shopStatus === "PUBLISHED" && qualified,
        shopStatus,
        shopDraftAt: initial?.shopDraftAt ?? null,
        allowBackorder,
        isActive,
        unitId: initial?.unitId ?? 0,
        categoryId: collectionIds[0] ?? null,
        collectionIds,
        groupId,
        brandId,
        warrantyTermId: initial?.warrantyTermId ?? null,
        weightGrams: weightGrams.trim() === "" ? null : parseInt(weightGrams, 10),
        lengthCm: lengthCm.trim() === "" ? null : parseInt(lengthCm, 10),
        breadthCm: breadthCm.trim() === "" ? null : parseInt(breadthCm, 10),
        heightCm: heightCm.trim() === "" ? null : parseInt(heightCm, 10),
        brandName,
        groupName,
        shopCategory: null,
        savedSalePricePaise: initial?.savedSalePricePaise ?? null,
        barcodePricePaise: initial?.barcodePricePaise ?? null,
        // Preview card is display-only; codes exist purely for list search.
        codes: initial?.codes ?? [],
        photoChecklist,
        // availability is display-only on the storefront; the admin preview card
        // doesn't need a resolved value.
        stockStatus: "in_stock",
        orderable: true,
    };

    /**
     * A new product: create. An existing one: no act = Save (stage kept — a
     * Published product changes live); "save" = Save as draft (off the shop);
     * "ready" = Save as ready; "discard" = Discard draft (back to the stage it
     * came from, edits kept); or move the stage — markReady, publish, unpublish.
     */
    const submit = async (act?: "save" | "ready" | "discard" | "markReady" | "publish" | "unpublish") => {

        if (!name.trim()) { toast.error("Name is required"); return; }
        if (!sku.trim() && !initial?.id) { toast.error("SKU is required"); return; }
        const specs = Object.fromEntries(specPairs.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v.trim()]));
        const payload = {
            sku: sku.trim() || undefined,
            name: name.trim(),
            slug: slug.trim() || null,
            shopSubheading: subheading.trim() || null,
            shopDescription: description.trim() || null,
            // The old free-text shop category is retired — the group is the
            // category. Saving clears any leftover override.
            shopCategory: null,
            ...(canEditMasters && groupId !== (initial?.groupId ?? null) ? { groupId } : {}),
            ...(canEditMasters && brandId !== (initial?.brandId ?? null) ? { brandId } : {}),
            ...(canEditMasters && collectionIds.join(",") !== (initial?.collectionIds ?? []).join(",") ? { collectionIds } : {}),
            // pricePaise / mrpPaise / stock / lowStockThreshold deliberately
            // absent — this form does not own them (see the state block above).
            // The PATCH route skips any column it isn't sent, so the pricing
            // engine keeps price/MRP, the stock ledger keeps stock, and the
            // Reorder page keeps the threshold.
            shopBadge: badge.trim() || null,
            // An existing product's photos autosave on their own (above); sending
            // the list again here could only put back a stale one.
            ...(initial?.id ? {} : { galleryUrls, imageUrl: galleryUrls[0] ?? null }),
            specs,
            weightGrams: weightGrams.trim() === "" ? null : parseInt(weightGrams, 10),
            lengthCm: lengthCm.trim() === "" ? null : parseInt(lengthCm, 10),
            breadthCm: breadthCm.trim() === "" ? null : parseInt(breadthCm, 10),
            heightCm: heightCm.trim() === "" ? null : parseInt(heightCm, 10),
            allowBackorder,
            isActive,
        };

        setBusy(true);
        try {
            const body = act === "save" || act === "ready" ? { ...payload, draft: act }
                : act === "discard" ? { draft: "discard" }
                    : act === "markReady" || act === "unpublish" ? { shopStatus: "READY" }
                        : act === "publish" ? { shopStatus: "PUBLISHED" }
                            : payload;
            const res = initial?.id
                ? await axios.patch<ShopProductAdmin>(`/api/ecommerce/products/${initial.id}`, body)
                : await axios.post<ShopProductAdmin>(`/api/ecommerce/products`, payload);
            const saved = res.data;
            const live = saved.shopStatus === "PUBLISHED"
                ? saved.isListedInShop ? "live in the shop" : "pending until Shop readiness is met"
                : "";
            toast.success(
                act === "save" ? "Saved as draft — off the shop until Save as ready"
                    : act === "ready" ? readyNote || "Saved as ready — publish when the time is right"
                        : act === "discard" ? `Draft closed — back to ${saved.shopStatus === "PUBLISHED" ? live || "Published" : saved.shopStatus.toLowerCase()}`
                            : act === "markReady" ? readyNote || "Marked ready — publish when the time is right"
                                : act === "publish" ? `Published — ${live}`
                                    : act === "unpublish" ? "Unpublished — off the shop, kept as Ready"
                                        : live ? `Saved — ${live}` : "Saved",
            );
            onSaved?.(res.data);
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Save failed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="grid gap-8 lg:grid-cols-2">
            <div className="space-y-4">
                {/* A saved product's Name is built from the naming convention and
                    shown in the page header (locked) — picking a Group or Brand
                    rebuilds it; Deep edit owns the Custom part. A new product still
                    types its first name here. */}
                {!initial?.id ? (
                    <div className="grid gap-1.5">
                        <Label>Name</Label>
                        <Input
                            value={name}
                            onChange={(e) => {
                                const v = e.target.value;
                                setName(v);
                                // Mirror into the online display name until the operator
                                // edits that field directly.
                                if (!subheadingTouched.current) setSubheading(v);
                            }}
                        />
                    </div>
                ) : null}
                <div className="grid grid-cols-[8rem_1fr] gap-3">
                    <div className="grid gap-1.5">
                        <Label>SKU</Label>
                        <Input
                            value={sku}
                            onChange={(e) => setSku(e.target.value)}
                            disabled={!!initial?.id}
                            className="font-mono"
                            placeholder="e.g. LAPTOP-001"
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label>Online display name</Label>
                        <Input
                            value={subheading}
                            onChange={(e) => {
                                subheadingTouched.current = true;
                                setSubheading(e.target.value);
                            }}
                            placeholder="Shown to customers — defaults to Name"
                        />
                    </div>
                </div>
                <div className="grid grid-cols-2 items-start gap-3">
                    <div className="grid gap-1.5">
                        <Label>Slug (optional)</Label>
                        <div className="flex items-center gap-2">
                            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="storefront URL handle" />
                            {initial?.id ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    disabled={regenBusy !== null}
                                    onClick={() => void regenerate()}
                                    title="Rebuild the slug from Settings → Naming Convention. Changing a live slug breaks its old URL."
                                >
                                    <RefreshCw className="size-4" />
                                </Button>
                            ) : null}
                        </div>
                    </div>
                    <div className="grid gap-1.5">
                        <Label>Collections</Label>
                        {canEditMasters ? (
                            <SearchableMultiSelect
                                value={collectionIds}
                                onChange={setCollectionIds}
                                onCreate={() => openCreateMaster("category")}
                                createLabel="+ New collection…"
                                placeholder="Add a collection…"
                                primaryLabel="Main collection"
                                showChips={false}
                                options={collectionOptions}
                            />
                        ) : (
                            <Input value={collectionNames.join(", ")} placeholder="No collection" disabled />
                        )}
                    </div>
                    {canEditMasters && collectionIds.length > 0 ? (
                        <div className="col-start-2 -mt-1">
                            <MultiSelectChips
                                value={collectionIds}
                                onChange={setCollectionIds}
                                options={collectionOptions}
                                primaryLabel="Main collection"
                            />
                        </div>
                    ) : null}
                    <div className="grid gap-1.5">
                        <Label>Group</Label>
                        {canEditMasters ? (
                            <SearchableSelect
                                value={groupId}
                                onChange={(v) => pickMaster({ groupId: v, brandId })}
                                onCreate={() => openCreateMaster("group")}
                                createLabel="+ New group…"
                                placeholder="No group"
                                options={treeSelectOptions(masters?.groups ?? [])}
                            />
                        ) : (
                            <Input value={groupName ?? ""} placeholder="No group" disabled />
                        )}
                    </div>
                    <div className="grid gap-1.5">
                        <Label>Brand</Label>
                        {canEditMasters ? (
                            <SearchableSelect
                                value={brandId}
                                onChange={(v) => pickMaster({ groupId, brandId: v })}
                                onCreate={() => openCreateMaster("brand")}
                                createLabel="+ New brand…"
                                placeholder="No brand"
                                options={(masters?.brands ?? []).map((b) => ({ value: b.id, label: String(b.name ?? `#${b.id}`) }))}
                            />
                        ) : (
                            <Input value={brandName ?? ""} placeholder="No brand" disabled />
                        )}
                    </div>
                    <p className="col-span-2 -mt-1 text-[11px] text-muted-foreground">
                        Group = the shop&apos;s Category (and GST/HSN source). Collections = shop filters; ★ is the main one.
                        {initial?.id && groupId !== (initial?.groupId ?? null)
                            ? " A new group can change GST/HSN and rebuilds the Name."
                            : ""}
                    </p>
                </div>
                <InventoryMasterDropdownQuickDialog
                    open={masterKind !== null}
                    onOpenChange={(v) => {
                        if (v) return;
                        setMasterKind(null);
                        masterResolve.current?.(null);
                        masterResolve.current = null;
                    }}
                    kind={masterKind ?? "group"}
                    siblings={masterKind === "group" ? masters?.groups : masterKind === "category" ? masters?.categories : undefined}
                    gstRates={gstRates}
                    onCreated={async (id) => {
                        // Drop the held copy so the new row shows without waiting for a delta.
                        await invalidateMasters();
                        const m = await syncMasters();
                        if (m) setMasters(m);
                        masterResolve.current?.(id);
                        masterResolve.current = null;
                    }}
                />
                <AiCopyPanel
                    savedDraft={aiDraft}
                    productId={initial?.id}
                    name={name}
                    imageUrls={galleryUrls}
                    description={description}
                    subheading={subheading}
                    specPairs={specPairs}
                    onDescription={setDescription}
                    onSubheading={(v) => { subheadingTouched.current = true; setSubheading(v); }}
                    onSpecs={setSpecPairs}
                    collectionIds={canEditMasters ? collectionIds : undefined}
                    onCollections={canEditMasters ? setCollectionIds : undefined}
                    brandId={canEditMasters ? brandId : undefined}
                    onBrand={canEditMasters ? setBrandId : undefined}
                    onShipping={(s) => {
                        // Empty boxes only — a weight or size staff typed wins.
                        const fill = (set: (fn: (v: string) => string) => void, n?: number) => { if (n) set((v) => (v.trim() ? v : String(n))); };
                        fill(setWeightGrams, s.weightGrams);
                        fill(setLengthCm, s.lengthCm);
                        fill(setBreadthCm, s.breadthCm);
                        fill(setHeightCm, s.heightCm);
                    }}
                    photoChecklist={photoChecklist}
                    onPhotoChecklist={savePhotoChecklist}
                    onGallery={setGalleryUrls}
                    onAddPhotos={(urls, kinds) => {
                        setGalleryUrls((g) => [...g, ...urls]);
                        tickPhotoKinds(kinds);
                    }}
                    onParked={initial?.id ? () => void reloadRow() : undefined}
                    attention={initial?.id && attention ? {
                        text: attention, by: initial.shopAttentionBy, at: initial.shopAttentionAt, parked: shopStatus === "ATTENTION",
                    } : null}
                    review={initial?.shopDraft?.notes?.length ? {
                        notes: initial.shopDraft.notes, at: initial.shopDraft.notesAt, kept: initial.shopDraft.kept,
                    } : null}
                />
                <div className="grid gap-2">
                    <Label>Description</Label>
                    <textarea
                        className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-25 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                </div>
                {/* Price / MRP are read-only here — same columns the sale vouchers,
                    POS and shelf label use. Edited on Update & Print Labels, where
                    the selling voice (Strategy / Computed / Saved) is chosen. */}
                <div className="rounded-md border border-border bg-muted/40 p-3">
                    <div className="flex items-center justify-between gap-3">
                        <Label className="text-muted-foreground">Price &amp; MRP</Label>
                        <GatedLink
                            href="/office/pricing-strategy/update-print-labels"
                            className="inline-flex items-center gap-1 text-xs text-primary underline"
                        >
                            Edit in Pricing Strategy
                            <ExternalLink className="size-3" />
                        </GatedLink>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-xs text-muted-foreground">Shop price (barcode tag)</p>
                            <p className="text-lg font-semibold tabular-nums">
                                {shopPricePaise > 0 ? formatRupeesFromPaise(shopPricePaise) : "—"}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">MRP</p>
                            <p className="text-lg font-semibold tabular-nums">
                                {effectiveMrpPaise ? formatRupeesFromPaise(effectiveMrpPaise) : "—"}
                            </p>
                        </div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                        One price everywhere — shelf, POS and shop all charge this.
                    </p>
                </div>
                <div className="grid gap-2">
                    <Label>Badge</Label>
                    <Input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="e.g. Sale" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    {/* Stock is read-only — it is the ledger balance, not an input.
                        It changes by posting an inventory voucher. */}
                    <div className="grid gap-2">
                        <Label className="text-muted-foreground">Stock (from ledger)</Label>
                        <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3">
                            <span className="text-sm font-semibold tabular-nums">
                                {stockValue === null ? "Not tracked" : stockValue}
                            </span>
                        </div>
                    </div>
                    {/* Reorder input, not a shop field — the storefront never reads
                        it. Edited on the Reorder page, which shows it in context. */}
                    <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-2">
                            <Label className="text-muted-foreground">Low-stock floor</Label>
                            <GatedLink
                                href="/office/inventory/reorder"
                                className="inline-flex items-center gap-1 text-xs text-primary underline"
                            >
                                Reorder
                                <ExternalLink className="size-3" />
                            </GatedLink>
                        </div>
                        <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3">
                            <span className="text-sm font-semibold tabular-nums">{lowStockThresholdValue}</span>
                        </div>
                    </div>
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">
                    Stock comes from posted inventory vouchers — edit it there, not here.
                    &ldquo;Not tracked&rdquo; means the shop always treats it as in stock. The low-stock
                    floor only feeds the Reorder report, never the storefront.
                </p>
                <div className="grid gap-2">
                    <Label>Shipping weight (grams)</Label>
                    <Input
                        value={weightGrams}
                        onChange={(e) => setWeightGrams(e.target.value)}
                        inputMode="numeric"
                        placeholder="e.g. 500 — actual weight"
                    />
                </div>
                <div className="grid gap-2">
                    <Label>Parcel dimensions (cm) — for volumetric weight</Label>
                    <div className="grid grid-cols-3 gap-3">
                        <Input value={lengthCm} onChange={(e) => setLengthCm(e.target.value)} inputMode="numeric" placeholder="Length" />
                        <Input value={breadthCm} onChange={(e) => setBreadthCm(e.target.value)} inputMode="numeric" placeholder="Breadth" />
                        <Input value={heightCm} onChange={(e) => setHeightCm(e.target.value)} inputMode="numeric" placeholder="Height" />
                    </div>
                    {(() => {
                        const l = parseInt(lengthCm, 10) || 0;
                        const b = parseInt(breadthCm, 10) || 0;
                        const h = parseInt(heightCm, 10) || 0;
                        const vol = l > 0 && b > 0 && h > 0 ? Math.round((l * b * h * 1000) / 5000) : 0;
                        const actual = parseInt(weightGrams, 10) || 0;
                        if (vol === 0) return null;
                        const charged = Math.max(actual, vol);
                        return (
                            <p className="text-xs text-muted-foreground">
                                Volumetric {vol} g (L×B×H ÷ 5000). Couriers charge on{" "}
                                <span className="font-medium">max(actual, volumetric) = {charged} g</span>
                                {charged > actual ? " (volumetric wins)" : ""}.
                            </p>
                        );
                    })()}
                </div>
                <div className="flex items-center gap-2">
                    <Switch id="backorder" checked={allowBackorder} onCheckedChange={setAllowBackorder} />
                    <Label htmlFor="backorder">
                        Allow orders when out of stock
                        <span className="text-muted-foreground ml-1 text-xs">(backorder — overrides the shop policy)</span>
                    </Label>
                </div>
                <div className="flex items-center gap-2">
                    <Switch id="active" checked={isActive} onCheckedChange={setIsActive} />
                    <Label htmlFor="active">Active</Label>
                </div>

                <div className="space-y-2">
                    <Label>Specs</Label>
                    {specPairs.map((row, i) => (
                        <div key={i} className="flex gap-2">
                            <Input
                                placeholder="Label"
                                value={row.k}
                                onChange={(e) => {
                                    const next = [...specPairs];
                                    next[i] = { ...next[i], k: e.target.value };
                                    setSpecPairs(next);
                                }}
                            />
                            <Input
                                placeholder="Value"
                                value={row.v}
                                onChange={(e) => {
                                    const next = [...specPairs];
                                    next[i] = { ...next[i], v: e.target.value };
                                    setSpecPairs(next);
                                }}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                onClick={() => setSpecPairs(specPairs.filter((_, j) => j !== i))}
                            >
                                <X className="size-4" />
                            </Button>
                        </div>
                    ))}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSpecPairs([...specPairs, { k: "", v: "" }])}
                    >
                        Add spec row
                    </Button>
                </div>

                {initial?.id ? (
                    <AttentionDialog
                        ids={flagOpen ? [initial.id] : null}
                        onClose={() => setFlagOpen(false)}
                        onDone={() => void reloadRow()}
                    />
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                    {!initial?.id ? (
                        <Button type="button" onClick={() => void submit()} disabled={busy}>
                            {busy ? "Saving…" : submitLabel}
                        </Button>
                    ) : drafting ? (
                        <>
                            {/* Published / Pending: changes go straight to the shop, or park in Draft.
                                Every other stage: Draft or Ready — no stage-less plain Save. */}
                            {shopStatus === "PUBLISHED" ? (
                                <Button type="button" onClick={() => void submit()} disabled={busy}
                                    title={initial?.isListedInShop ? "Save — the shop shows the changes at once" : "Save — still Pending until Shop readiness is met"}>
                                    Publish changes
                                </Button>
                            ) : null}
                            <Button type="button" variant={shopStatus === "PUBLISHED" ? "outline" : "default"} onClick={() => void submit("save")} disabled={busy}
                                title="Save and move to Draft — off the shop until Save as ready">
                                Save as draft
                            </Button>
                            {shopStatus !== "PUBLISHED" && (
                                <Button type="button" variant="outline" onClick={() => void submit("ready")} disabled={busy}
                                    title="Save — Ready to publish">
                                    Save as ready
                                </Button>
                            )}
                        </>
                    ) : shopStatus === "ATTENTION" ? (
                        <>
                            <Button type="button" onClick={() => void submit("save")} disabled={busy}
                                title="Checked — back to Draft to carry on working">
                                Save as draft
                            </Button>
                            <Button type="button" variant="outline" onClick={() => void submit("ready")} disabled={busy}
                                title="Checked and complete — Ready to publish">
                                Save as ready
                            </Button>
                        </>
                    ) : shopStatus === "DRAFT" ? (
                        <>
                            <Button type="button" onClick={() => void submit("ready")} disabled={busy}
                                title="The work is done — Ready to publish">
                                Save as ready
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => void submit("discard")} disabled={busy}
                                title="Leave Draft — back to the stage it came from; the edits stay">
                                Discard draft
                            </Button>
                        </>
                    ) : shopStatus === "UNPUBLISHED" ? (
                        <Button type="button" variant="outline" onClick={() => void submit("markReady")} disabled={busy}
                            title="The product is complete — Ready to publish">
                            Mark ready
                        </Button>
                    ) : shopStatus === "READY" ? (
                        <Button type="button" onClick={() => void submit("publish")} disabled={busy}
                            title={qualified ? "Go live in the shop" : "Publish — waits as Pending until Shop readiness is met"}>
                            Publish
                        </Button>
                    ) : (
                        <Button type="button" variant="outline" onClick={() => void submit("unpublish")} disabled={busy}
                            title="Take it off the shop — kept as Ready">
                            Unpublish
                        </Button>
                    )}
                    {initial?.id && shopStatus === "DRAFT" && !drafting ? (
                        <Button type="button" variant="ghost" className="text-orange-700" onClick={() => setFlagOpen(true)} disabled={busy}
                            title="Work blocked until something is checked by hand — park it in Attention with the reason">
                            Flag attention
                        </Button>
                    ) : null}
                    {onClose && (
                        <Button type="button" variant="outline" onClick={onClose} disabled={busy}
                            title="Back to the Products list">
                            Close
                        </Button>
                    )}
                    <span className="text-muted-foreground text-xs">
                        {drafting
                            ? `Unsaved changes${shopStatus === "PUBLISHED" ? " — Publish changes puts them live; Save as draft takes it off the shop" : ""}.`
                            : shopStatus === "DRAFT"
                                ? "Draft — being worked on, not in the shop."
                            : shopStatus === "ATTENTION"
                                ? "Attention — parked until it is checked, not in the shop."
                            : shopStatus === "READY"
                                ? `Ready — complete, waiting to be published${qualified ? "" : `; needs ${qualification.missing.join(", ").toLowerCase()}`}.`
                                : shopStatus === "PUBLISHED"
                                    ? qualified ? "Published — live in the shop." : `Pending — needs ${qualification.missing.join(", ").toLowerCase()}.`
                                    : "Unpublished — not worked on yet."}
                    </span>
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label>Live preview</Label>
                    {/* The card's photo, name and Details open the full-page preview in
                        the app, draft or live. A published product also has its real
                        shop page, which opens in the computer's own browser. */}
                    {initial?.id && published ? (
                        <span className="flex items-center gap-3">
                            <GatedLink href={`/office/campaigns/posts/new?product=${initial.id}`} className="text-xs text-primary underline">
                                Make a post
                            </GatedLink>
                            <a
                                href={productShopUrl({ id: initial.id, slug: initial.slug ?? null })}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary underline"
                            >
                                Open in shop
                                <ExternalLink className="size-3" />
                            </a>
                        </span>
                    ) : null}
                </div>
                <div className="rounded-lg border border-dashed border-border p-4">
                    <ProductCard product={previewProduct as ShopProductPublic} preview={!!initial?.id} />
                </div>
                {/* Photos sit under the live card: every change here is seen
                    immediately in the card above, so no second preview is needed. */}
                <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                        <Label>Photos</Label>
                        {initial?.id ? (
                            <span className="text-xs text-muted-foreground">
                                {galleryStatus === "saving"
                                    ? "Saving…"
                                    : galleryStatus === "saved"
                                        ? "Saved"
                                        : galleryStatus === "error"
                                            ? "Save failed"
                                            : ""}
                            </span>
                        ) : (
                            <span className="text-xs text-muted-foreground">Saves after you create the product</span>
                        )}
                    </div>
                    <ProductGalleryUploader
                        urls={galleryUrls}
                        onChange={setGalleryUrls}
                        selected={selectedImage}
                        onSelectedChange={setSelectedImage}
                    />
                </div>

                {/* Option buttons on the shop page — saves on its own (lib/variants.ts). */}
                {initial?.id ? (
                    <ProductVariantsSection
                        productId={initial.id}
                        onMembersChange={(ms) => {
                            const self = ms.find((m) => m.id === initial.id);
                            setSelfGaps(self ? self.gaps : []);
                        }}
                    />
                ) : null}

                <div className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Shop readiness</Label>
                        <span className={qualified ? "text-xs font-medium text-emerald-600" : "text-xs font-medium text-amber-600"}>
                            {qualified ? "Qualified" : "Not ready"}
                        </span>
                    </div>
                    <ul className="space-y-1">
                        {qualification.checks.map((c) => (
                            <li key={c.key} className="space-y-1">
                                <div className="flex items-center gap-2 text-sm">
                                    {c.ok ? (
                                        <Check className="size-4 text-emerald-600" />
                                    ) : (
                                        <X className="size-4 text-muted-foreground" />
                                    )}
                                    <span className={c.ok ? "" : "text-muted-foreground"}>{c.label}</span>
                                </div>
                                {c.key === "image" && photoChecklist && (photoChecklist.items.length > 0 || photoChecklist.remove.length > 0) && (
                                    <PhotoChecklistRows
                                        checklist={photoChecklist}
                                        gallery={galleryUrls}
                                        onToggle={(k) => tickPhotoKinds([k], true)}
                                        onRemove={(url) => {
                                            // Same as the gallery's Delete; the gallery autosaves.
                                            setGalleryUrls((g) => g.filter((u) => u !== url));
                                            setSelectedImage(0);
                                            savePhotoChecklist({ ...photoChecklist, remove: photoChecklist.remove.filter((r) => r.url !== url) });
                                        }}
                                    />
                                )}
                            </li>
                        ))}
                    </ul>
                    {initial?.barcodePricePaise != null ? (
                        <p className="text-xs text-muted-foreground">
                            Shop price (barcode): <span className="font-medium tabular-nums">{formatRupeesFromPaise(initial.barcodePricePaise)}</span> — derived from the saved sale price.
                        </p>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
