"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useShopCartStore } from "@/store/external/shopCartStore";
import { usePortalAccountStore } from "@/store/external/portalAccountStore";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { useValueChange } from "@/shared/hooks/useValueChange";
import { isDeliverable, type AddressRow } from "@/shared/lib/address/address";
import { EMPTY_ADDRESS_DRAFT, type AddressDraft } from "@/shared/components/address/AddressForm";

/**
 * Everything a checkout knows and does — the address (its PIN lookups and
 * local-delivery areas live in the shared AddressForm), the courier quote, the payment rails, the level /
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

const EMPTY_ADDRESS: AddressDraft = { ...EMPTY_ADDRESS_DRAFT };

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

    const [address, setAddress] = useState<AddressDraft>(EMPTY_ADDRESS);

    // The customer's address book. Checkout opens on the last one used (else the
    // main one) as "Deliver to …"; Change lists the rest + a new one. Whatever is
    // shipped to is saved back to that row (or as a new row) by the order route.
    const profile = usePortalAccountStore((s) => s.profile);
    const [savedAddresses, setSavedAddresses] = useState<AddressRow[] | null>(null);
    const [addressId, setAddressId] = useState<number | null>(null);
    // The full form shows for a new address, or one missing what delivery needs.
    const [addressOpen, setAddressOpen] = useState(true);
    const fillFrom = (row: AddressRow | null) => {
        const me = { name: profile?.name ?? "", phone: profile?.phones.find((p) => p.isPrimary)?.value ?? profile?.phones[0]?.value ?? "" };
        setAddressId(row?.id ?? null);
        setAddress(
            row
                ? {
                      ...EMPTY_ADDRESS,
                      label: row.label ?? "",
                      name: row.name || me.name,
                      phone: row.phone || me.phone,
                      line1: row.line1,
                      line2: row.line2 ?? "",
                      landmark: row.landmark ?? "",
                      pincode: row.pincode ?? "",
                      locality: row.locality ?? "",
                      neighbourhood: row.neighbourhood ?? "",
                      city: row.city ?? "",
                      state: row.state ?? "",
                  }
                : { ...EMPTY_ADDRESS, ...me },
        );
        setAddressOpen(!row || !isDeliverable(row));
    };
    const signedIn = !!activeAccountId;
    useEffect(() => {
        if (!signedIn || savedAddresses) return;
        let cancelled = false;
        axios
            .get<{ addresses: AddressRow[] }>("/api/portal/addresses")
            .then(({ data }) => {
                if (cancelled) return;
                setSavedAddresses(data.addresses);
                const used = data.addresses.filter((a) => a.lastUsedAt).sort((a, b) => +new Date(b.lastUsedAt!) - +new Date(a.lastUsedAt!));
                fillFrom(used[0] ?? data.addresses.find((a) => a.isPrimary) ?? data.addresses[0] ?? null);
            })
            .catch(() => !cancelled && setSavedAddresses([]));
        return () => {
            cancelled = true;
        };
        // Once per sign-in; fillFrom reads the profile at that moment on purpose.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signedIn, savedAddresses]);
    /** Change → a saved address (id) or a blank new one (null). */
    const pickAddress = (id: number | null) => fillFrom(savedAddresses?.find((a) => a.id === id) ?? null);

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
                // The saved address this went to (edits are saved onto it); none = a new one.
                addressId: addressId ?? undefined,
                shippingAddress: {
                    name: address.name.trim(),
                    phone: address.phone.trim(),
                    line1: address.line1.trim(),
                    line2: address.line2.trim() || null,
                    landmark: address.landmark.trim() || null,
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
        setAddress,
        savedAddresses,
        addressId,
        pickAddress,
        addressOpen,
        setAddressOpen,
        pincodeValid,
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
