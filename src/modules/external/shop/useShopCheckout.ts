"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { usePortalAccountStore } from "@/store/external/portalAccountStore";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { useValueChange } from "@/shared/hooks/useValueChange";
import { trackPurchase } from "@/shared/lib/shop/trackingCodes";

/**
 * Everything a checkout knows and does — the address with its pincode lookups
 * and local-delivery areas, the courier quote, the payment rails, the level /
 * coupon / loyalty preview, and placing the order. The website checkout page and
 * the customer app's step-by-step checkout both draw from this one hook, so the
 * rules (and the payment hand-off) are never written twice. `onPlaced` decides
 * where the customer goes once the order exists.
 */

export type ShippingOption = {
    optionId: string;
    methodId: number;
    kind: "SHIPROCKET" | "SHIPWAY" | "CUSTOM" | "OWN_BOY" | "STORE_PICKUP" | "FREE_DELIVERY";
    serviceName?: string;
    label: string;
    amountPaise: number;
    etaText: string | null;
    /** Store pickup only — the store's note (address / timings) shown when selected. */
    pickupNote?: string;
    /** Dev-only: courier dropped by the dedupe/cap, shown in a dev panel. */
    hidden?: boolean;
};

const EMPTY_ADDRESS = { name: "", phone: "", line1: "", line2: "", pincode: "", locality: "", neighbourhood: "", city: "", state: "" };

export type BenefitPreview = {
    tierPct: number; tierLabel: string | null; discountPaise: number;
    coupon: { code: string; name: string; discountPaise: number; droppedTier: boolean } | null;
    freeGrant: { code: string; productName: string; freeQty: number } | null;
    moneyGrant: { code: string; productName: string; freeQty: number } | null;
    onTop: { code: string; name: string; discountPaise: number } | null;
    couponError: string | null;
    loyalty: {
        balance: number; redeemValue: number; minRedeemPoints: number;
        maxRedeemablePts: number; redeemPoints: number; redeemPaise: number;
        redeemError: string | null;
    } | null;
};

export function useShopCheckout({ onPlaced }: { onPlaced: (orderId: number) => void }) {
    const lines = useShopCartStore((s) => s.lines);
    const clear = useShopCartStore((s) => s.clear);
    const activeAccountId = usePortalAccountStore((s) => s.activeAccountId);
    const accountOptions = usePortalAccountStore((s) => s.options);
    const accountLoading = usePortalAccountStore((s) => s.loading);
    const [products, setProducts] = useState<ShopProductPublic[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    // Enabled online gateways (0..n) — any of them enables the "Pay online" rail;
    // the customer picks the specific gateway on the order/payment page.
    const [onlineGateways, setOnlineGateways] = useState<{ provider: string; displayName: string }[]>([]);
    // The Pay-on-Delivery rail — active + whether it serves the entered address.
    const [pod, setPod] = useState<{ active: boolean; availableHere: boolean; displayName: string } | null>(null);
    // The selected payment rail: "cod" or an online gateway's provider id.
    const [payChoice, setPayChoice] = useState<string>("cod");

    const [address, setAddress] = useState(EMPTY_ADDRESS);
    const setField = (k: keyof typeof EMPTY_ADDRESS) => (v: string) => setAddress((a) => ({ ...a, [k]: v }));

    // Live courier quote for the entered pincode + cart.
    const [options, setOptions] = useState<ShippingOption[]>([]);
    const [quoting, setQuoting] = useState(false);
    const [quoteError, setQuoteError] = useState("");
    const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);

    useEffect(() => {
        axios
            .get<ShopProductPublic[]>("/api/shop/products")
            .then((r) => setProducts(r.data))
            .catch(() => setProducts([]));
    }, []);

    const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
    const total = useMemo(() => {
        let t = 0;
        for (const l of lines) {
            const p = byId.get(l.productId);
            if (p) t += p.pricePaise * l.quantity;
        }
        return t;
    }, [lines, byId]);

    const pincodeValid = /^\d{6}$/u.test(address.pincode);
    const [pincodeInfo, setPincodeInfo] = useState<string>("");
    const [localities, setLocalities] = useState<string[]>([]);
    // Our local delivery boy's coverage for this pincode: locality → [neighbourhoods].
    const [coverage, setCoverage] = useState<Record<string, string[]>>({});

    // A pincode that stops being valid clears what was looked up for it — while
    // rendering (the effects below only read for a valid one).
    if (useValueChange(pincodeValid) && !pincodeValid) {
        setCoverage({});
        setPincodeInfo("");
        setLocalities([]);
    }

    // Load local-delivery neighbourhood coverage for the pincode (enables the
    // linked Locality ↔ Neighbourhood pickers + the Local delivery courier).
    useEffect(() => {
        if (!pincodeValid) return;
        let cancelled = false;
        axios
            .get<{ localities: Record<string, string[]> }>(`/api/shop/local-coverage/${address.pincode}`)
            .then((r) => {
                if (cancelled) return;
                const cov = r.data.localities ?? {};
                setCoverage(cov);
                // Drop a stale neighbourhood if it isn't covered under the new pincode.
                setAddress((a) => {
                    const all = Object.values(cov).flat();
                    return a.neighbourhood && !all.includes(a.neighbourhood) ? { ...a, neighbourhood: "" } : a;
                });
            })
            .catch(() => {
                if (!cancelled) setCoverage({});
            });
        return () => {
            cancelled = true;
        };
    }, [address.pincode, pincodeValid]);

    // Auto-fill City + State + locality options from the pincode (India Post
    // lookup). Runs whenever a valid 6-digit pincode is entered; the resolved
    // state also drives zone matching.
    if (useValueChange(pincodeValid ? address.pincode : null) && pincodeValid) setPincodeInfo("Detecting location…");
    useEffect(() => {
        if (!pincodeValid) return;
        let cancelled = false;
        axios
            .get<{ ok: boolean; city?: string; state?: string; localities?: string[] }>(`/api/shop/pincode/${address.pincode}`)
            .then((r) => {
                if (cancelled) return;
                if (r.data.ok) {
                    const locs = Array.isArray(r.data.localities) ? r.data.localities : [];
                    setLocalities(locs);
                    setAddress((a) => ({
                        ...a,
                        city: r.data.city || a.city,
                        state: r.data.state || a.state,
                        // Reset the locality when the pincode changes; auto-pick when
                        // there's only one so the customer needn't choose.
                        locality: locs.length === 1 ? locs[0] : "",
                    }));
                    setPincodeInfo(r.data.city && r.data.state ? `${r.data.city}, ${r.data.state}` : "");
                } else {
                    setLocalities([]);
                    setPincodeInfo("Couldn't detect — enter city & state.");
                }
            })
            .catch(() => {
                if (!cancelled) setPincodeInfo("");
            });
        return () => {
            cancelled = true;
        };
    }, [address.pincode, pincodeValid]);

    // Payment rails available for this address: the online gateway (address-
    // independent) + Pay-on-Delivery (folds in its Active toggle + area rule). Re-runs
    // as the pincode/state changes so a blocked area hides the POD button live.
    useEffect(() => {
        let cancelled = false;
        const params = pincodeValid
            ? `?pincode=${encodeURIComponent(address.pincode)}${address.state ? `&state=${encodeURIComponent(address.state)}` : ""}`
            : "";
        axios
            .get<{
                online: { provider: string; displayName: string }[];
                payOnDelivery: { active: boolean; availableHere: boolean; displayName: string };
            }>(`/api/shop/payment-config${params}`)
            .then((r) => {
                if (cancelled) return;
                setOnlineGateways(r.data.online ?? []);
                setPod(r.data.payOnDelivery ?? null);
            })
            .catch(() => {
                if (cancelled) return;
                setOnlineGateways([]);
                setPod(null);
            });
        return () => {
            cancelled = true;
        };
    }, [address.pincode, address.state, pincodeValid]);

    // Fetch courier options whenever the pincode becomes valid (or the cart changes).
    // A new quote (or none to make) is set up while rendering; the effect reads.
    const quoteKey = pincodeValid && lines.length > 0
        ? JSON.stringify([address.pincode, address.state, address.neighbourhood, lines, payChoice])
        : null;
    if (useValueChange(quoteKey)) {
        if (quoteKey === null) {
            setOptions([]);
            setSelectedOptionId(null);
        } else {
            setQuoting(true);
            setQuoteError("");
        }
    }
    useEffect(() => {
        if (!pincodeValid || lines.length === 0) return;
        let cancelled = false;
        axios
            .post<{ options: ShippingOption[] }>("/api/shop/shipping/quote", {
                pincode: address.pincode,
                state: address.state || undefined,
                neighbourhood: address.neighbourhood || undefined,
                lines,
                cod: payChoice === "cod",
            })
            .then((r) => {
                if (cancelled) return;
                const opts = r.data.options ?? [];
                setOptions(opts);
                // Auto-select the first real (non-dev-hidden) option.
                const firstVisible = opts.find((o) => !o.hidden);
                setSelectedOptionId(firstVisible?.optionId ?? null);
                if (opts.length === 0) setQuoteError("No courier serves this pincode yet.");
            })
            .catch(() => {
                if (cancelled) return;
                setOptions([]);
                setSelectedOptionId(null);
                setQuoteError("Could not fetch delivery options. Check the pincode.");
            })
            .finally(() => {
                if (!cancelled) setQuoting(false);
            });
        return () => {
            cancelled = true;
        };
    }, [address.pincode, address.state, address.neighbourhood, pincodeValid, lines, payChoice]);

    // Linked Locality ↔ Neighbourhood pickers (pincode is the enabler).
    const hasCoverage = Object.keys(coverage).length > 0;
    // Locality options = India Post areas ∪ the localities we cover (so a
    // neighbourhood's parent locality is always selectable).
    const localityOptions = [...new Set([...localities, ...Object.keys(coverage)])];
    // Neighbourhood options: the selected locality's, else all covered ones.
    const neighbourhoodOptions = [
        ...new Set(address.locality && coverage[address.locality] ? coverage[address.locality] : Object.values(coverage).flat()),
    ];
    // Pick a locality → keep the neighbourhood only if still valid under it.
    const onLocalityChange = (v: string) =>
        setAddress((a) => {
            const loc = v === "__none__" ? "" : v;
            const valid = loc ? coverage[loc] ?? [] : Object.values(coverage).flat();
            return { ...a, locality: loc, neighbourhood: a.neighbourhood && valid.includes(a.neighbourhood) ? a.neighbourhood : "" };
        });
    // Pick a neighbourhood → its parent locality auto-fills.
    const onNeighbourhoodChange = (v: string) =>
        setAddress((a) => {
            const nb = v === "__none__" ? "" : v;
            const parent = nb ? Object.keys(coverage).find((l) => (coverage[l] ?? []).includes(nb)) ?? a.locality : a.locality;
            return { ...a, neighbourhood: nb, locality: parent };
        });

    const selected = options.find((o) => o.optionId === selectedOptionId) ?? null;
    const shipping = selected?.amountPaise ?? 0;

    // Customer-benefit preview — server-owned (/api/shop/tier-preview, the same
    // helper the order route freezes at checkout): the spend-tier "level"
    // discount + the coupon (typed code or best AUTO offer, POS stacking
    // rules). Logged-in only; a guest or a failed call just shows plain
    // prices. Display-only here — the order route recomputes and stores its
    // own numbers (and takes the coupon usage slot).
    const [tierPreview, setTierPreview] = useState<BenefitPreview | null>(null);
    // The APPLIED code / points (sent to preview + place-order); the input
    // boxes are separate drafts so typing doesn't spam the endpoint.
    const [couponCode, setCouponCode] = useState("");
    const [couponDraft, setCouponDraft] = useState("");
    const [redeemPts, setRedeemPts] = useState(0);
    const [redeemDraft, setRedeemDraft] = useState("");
    // "Use maximum points" tick — when on, the REQUESTED points track the
    // server's own ceiling (maxRedeemablePts) instead of a manual number, so
    // it stays correct as the cart/coupon change the ceiling. Derived, not
    // stored: maxRedeemablePts is computed by the server independently of how
    // many points were requested, so this converges within one extra preview
    // round-trip (first call requests 0 → server returns the real ceiling →
    // effect re-fires requesting exactly that ceiling → stable).
    const [useMaxPoints, setUseMaxPoints] = useState(false);
    const maxRedeemablePts = tierPreview?.loyalty?.maxRedeemablePts ?? 0;
    const requestedRedeemPts = useMaxPoints ? maxRedeemablePts : redeemPts;
    // No sync setState in the effect (react-hooks/set-state-in-effect) — a
    // guest / empty cart never fetches; the derived gate below hides stale rows.
    useEffect(() => {
        if (!activeAccountId || lines.length === 0) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            axios
                .post<BenefitPreview>("/api/shop/tier-preview", {
                    accountId: activeAccountId,
                    lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
                    couponCode: couponCode || undefined,
                    redeemPoints: requestedRedeemPts || undefined,
                })
                .then((r) => { if (!cancelled) setTierPreview(r.data); })
                .catch(() => { if (!cancelled) setTierPreview(null); });
        }, 300);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [activeAccountId, lines, couponCode, requestedRedeemPts]);
    const previewLive = !!activeAccountId && lines.length > 0 && !!tierPreview;
    const tierDiscount = previewLive ? tierPreview!.discountPaise : 0;
    const couponDiscount = previewLive ? (tierPreview!.coupon?.discountPaise ?? 0) : 0;
    const onTopDiscount = previewLive ? (tierPreview!.onTop?.discountPaise ?? 0) : 0;
    const loyaltyDiscount = previewLive ? (tierPreview!.loyalty?.redeemPaise ?? 0) : 0;

    const grand = Math.max(0, total - tierDiscount - couponDiscount - onTopDiscount - loyaltyDiscount) + shipping;

    // The "Pay on delivery" rail shows only when active AND it serves this address.
    const podShown = !!pod && pod.active && pod.availableHere;
    const hasOnline = onlineGateways.length > 0;
    const hasRail = podShown || hasOnline;
    const isCod = payChoice === "cod";

    // Keep the selected rail valid: if it disappears (POD blocked here, or a gateway
    // gets disabled), fall back to the first still-available rail.
    // While rendering; picking a valid rail is what ends it.
    const railValid =
        (payChoice === "cod" && podShown) ||
        onlineGateways.some((g) => g.provider === payChoice);
    if (!railValid) {
        if (podShown) setPayChoice("cod");
        else if (onlineGateways[0]) setPayChoice(onlineGateways[0].provider);
    }

    const addressComplete =
        address.name.trim() &&
        address.phone.trim().length >= 6 &&
        address.line1.trim() &&
        address.city.trim() &&
        address.state.trim() &&
        pincodeValid;

    const canPlace = !!activeAccountId && !!addressComplete && !!selected && hasRail && !loading;

    const submit = async () => {
        setLoading(true);
        setError("");
        try {
            if (!activeAccountId) {
                setError("Sign in and select a profile before placing order.");
                setLoading(false);
                return;
            }
            if (!selected) {
                setError("Choose a delivery option.");
                setLoading(false);
                return;
            }
            const { data: order } = await axios.post<{ id: number }>("/api/shop/orders", {
                lines,
                accountId: activeAccountId,
                shippingAddress: {
                    name: address.name.trim(),
                    phone: address.phone.trim(),
                    line1: address.line1.trim(),
                    line2: address.line2.trim() || null,
                    locality: address.locality.trim() || null,
                    neighbourhood: address.neighbourhood.trim() || null,
                    city: address.city.trim(),
                    state: address.state.trim(),
                    pincode: address.pincode.trim(),
                },
                optionId: selected.optionId,
                paymentMethod: isCod ? "COD" : "ONLINE",
                onlineProvider: isCod ? undefined : payChoice,
                // Applied coupon code — the server re-validates and freezes it
                // (AUTO offers apply server-side even without a code).
                couponCode: couponCode || undefined,
                // Loyalty points to burn — server clamps/validates; lots burn at
                // invoice post. requestedRedeemPts tracks the live ceiling when
                // "Use maximum points" is ticked.
                redeemPoints: requestedRedeemPts || undefined,
            });
            clear();
            trackPurchase(order.id, grand);
            onPlaced(order.id);
        } catch (err: unknown) {
            const msg =
                axios.isAxiosError(err) && err.response?.data && typeof err.response.data === "object"
                    ? (err.response.data as { error?: string }).error
                    : null;
            setError(msg || "Checkout failed");
        } finally {
            setLoading(false);
        }
    };

    return {
        lines,
        products,
        byId,
        total,
        loading,
        error,
        activeAccountId,
        accountOptions,
        accountLoading,
        onlineGateways,
        pod,
        payChoice,
        setPayChoice,
        address,
        setField,
        pincodeValid,
        pincodeInfo,
        localityOptions,
        neighbourhoodOptions,
        hasCoverage,
        onLocalityChange,
        onNeighbourhoodChange,
        options,
        quoting,
        quoteError,
        selectedOptionId,
        setSelectedOptionId,
        selected,
        shipping,
        tierPreview,
        couponCode,
        setCouponCode,
        couponDraft,
        setCouponDraft,
        redeemPts,
        setRedeemPts,
        redeemDraft,
        setRedeemDraft,
        useMaxPoints,
        setUseMaxPoints,
        maxRedeemablePts,
        requestedRedeemPts,
        tierDiscount,
        couponDiscount,
        onTopDiscount,
        loyaltyDiscount,
        grand,
        podShown,
        hasRail,
        isCod,
        addressComplete,
        canPlace,
        submit,
    };
}

export type ShopCheckout = ReturnType<typeof useShopCheckout>;
