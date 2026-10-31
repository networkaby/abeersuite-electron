"use client";

import { useEffect, useId, useState } from "react";
import axios from "axios";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { INDIA_STATE_NAMES } from "@/modules/delivery/lib/deliveryMethodConfig";
import { ADDRESS_LABELS, type AddressInput } from "@/shared/lib/address/address";

export type AddressDraft = {
    label: string;
    name: string;
    phone: string;
    line1: string;
    line2: string;
    landmark: string;
    locality: string;
    neighbourhood: string;
    city: string;
    state: string;
    pincode: string;
};

export const EMPTY_ADDRESS_DRAFT: AddressDraft = {
    label: "",
    name: "",
    phone: "",
    line1: "",
    line2: "",
    landmark: "",
    locality: "",
    neighbourhood: "",
    city: "",
    state: "",
    pincode: "",
};

/** A saved row → the form's strings. */
export const toDraft = (a: Partial<Record<keyof AddressDraft, string | null>>): AddressDraft =>
    Object.fromEntries(Object.keys(EMPTY_ADDRESS_DRAFT).map((k) => [k, a[k as keyof AddressDraft] ?? ""])) as AddressDraft;

/** The form's strings → what the API takes (blank = null; the server trims). */
export const fromDraft = (d: AddressDraft): AddressInput => ({ ...d });

export interface AddressFormProps {
    value: AddressDraft;
    onChange: (next: AddressDraft) => void;
    /** Receiver full name + phone — shown at checkout or on personal address book. */
    showRecipient?: boolean;
    /** Category chips (Home, Office, Shop) — shown on address books, omitted at checkout. */
    showLabelChips?: boolean;
    // Optional external control (e.g. passed from useShopCheckout):
    pincodeInfo?: string;
    localityOptions?: string[];
    neighbourhoodOptions?: string[];
    hasCoverage?: boolean;
    onLocalityChange?: (locality: string) => void;
    onNeighbourhoodChange?: (neighbourhood: string) => void;
}

/**
 * Universal address form: standard fields and layout across Office, POS, Customer Portal,
 * and Shop Checkout (web & app).
 *
 * Automatically resolves City & State from a 6-digit Pincode (India Post lookup) and
 * offers localities and local-delivery neighbourhoods when available.
 */
export default function AddressForm({
    value,
    onChange,
    showRecipient = false,
    showLabelChips = true,
    pincodeInfo,
    localityOptions: externalLocalityOptions,
    neighbourhoodOptions: externalNeighbourhoodOptions,
    hasCoverage: externalHasCoverage,
    onLocalityChange,
    onNeighbourhoodChange,
}: AddressFormProps) {
    const uid = useId();
    const [customLocality, setCustomLocality] = useState("");

    // Internal lookup state when external handlers/options are not provided
    const [internalLocalities, setInternalLocalities] = useState<string[]>([]);
    const [internalCoverage, setInternalCoverage] = useState<Record<string, string[]>>({});
    const [internalPincodeInfo, setInternalPincodeInfo] = useState<string>("");

    const isControlledLookup = externalLocalityOptions !== undefined;

    const pin = (value.pincode ?? "").replace(/\D/gu, "").slice(0, 6);
    const pinValid = /^\d{6}$/u.test(pin);

    // Self-managed lookups when not driven by an external checkout hook
    useEffect(() => {
        if (isControlledLookup) return;
        if (!pinValid) {
            setInternalLocalities([]);
            setInternalCoverage({});
            setInternalPincodeInfo("");
            return;
        }

        let live = true;
        setInternalPincodeInfo("Detecting location…");

        // 1. India Post pincode lookup for city, state, and localities
        axios
            .get<{ ok: boolean; city?: string; state?: string; localities?: string[] }>(`/api/shop/pincode/${pin}`)
            .then(({ data }) => {
                if (!live) return;
                if (!data.ok) {
                    setInternalLocalities([]);
                    setInternalPincodeInfo("Pincode not found — type city and state");
                    return;
                }
                const locs = Array.isArray(data.localities) ? data.localities : [];
                setInternalLocalities(locs);
                setInternalPincodeInfo(data.city && data.state ? `${data.city}, ${data.state}` : "");
                onChange({
                    ...value,
                    city: value.city || data.city || "",
                    state: value.state || data.state || "",
                    locality: value.locality || (locs.length === 1 ? locs[0] : ""),
                });
            })
            .catch(() => {
                if (live) {
                    setInternalLocalities([]);
                    setInternalPincodeInfo("");
                }
            });

        // 2. Local delivery neighbourhood coverage
        axios
            .get<{ localities: Record<string, string[]> }>(`/api/shop/local-coverage/${pin}`)
            .then(({ data }) => {
                if (!live) return;
                const cov = data.localities ?? {};
                setInternalCoverage(cov);
                const all = Object.values(cov).flat();
                if (value.neighbourhood && !all.includes(value.neighbourhood)) {
                    onChange({ ...value, neighbourhood: "" });
                }
            })
            .catch(() => {
                if (live) setInternalCoverage({});
            });

        return () => {
            live = false;
        };
        // Runs only when the 6-digit pin changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pin, pinValid, isControlledLookup]);

    const activeLocalityOptions = externalLocalityOptions ?? internalLocalities;
    const activeHasCoverage = externalHasCoverage ?? Object.keys(internalCoverage).length > 0;
    const activeNeighbourhoodOptions = externalNeighbourhoodOptions ?? [
        ...new Set(
            value.locality && internalCoverage[value.locality]
                ? internalCoverage[value.locality]
                : Object.values(internalCoverage).flat(),
        ),
    ];
    const activePincodeInfo = pincodeInfo ?? internalPincodeInfo;

    const set = (k: keyof AddressDraft) => (v: string) => onChange({ ...value, [k]: v });

    const handleLocalityChange = (v: string) => {
        if (onLocalityChange) {
            onLocalityChange(v);
            return;
        }
        const loc = v === "__none__" ? "" : v;
        const valid = loc ? internalCoverage[loc] ?? [] : Object.values(internalCoverage).flat();
        onChange({
            ...value,
            locality: loc,
            neighbourhood: value.neighbourhood && valid.includes(value.neighbourhood) ? value.neighbourhood : "",
        });
    };

    const handleNeighbourhoodChange = (v: string) => {
        if (onNeighbourhoodChange) {
            onNeighbourhoodChange(v);
            return;
        }
        const nb = v === "__none__" ? "" : v;
        const parent = nb
            ? Object.keys(internalCoverage).find((l) => (internalCoverage[l] ?? []).includes(nb)) ?? value.locality
            : value.locality;
        onChange({ ...value, neighbourhood: nb, locality: parent });
    };

    const displayLocalityOptions = Array.from(
        new Set([
            ...activeLocalityOptions,
            ...(value.locality && value.locality !== "__none__" ? [value.locality] : []),
        ]),
    );

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            {showLabelChips && (
                <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2">
                    {ADDRESS_LABELS.map((l) => (
                        <button
                            key={l}
                            type="button"
                            onClick={() => set("label")(value.label === l ? "" : l)}
                            className={`rounded-full border px-2.5 py-0.5 text-xs ${
                                value.label === l ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"
                            }`}
                        >
                            {l}
                        </button>
                    ))}
                    <Input
                        value={value.label ?? ""}
                        onChange={(e) => set("label")(e.target.value)}
                        placeholder="or a name"
                        className="h-7 w-28 text-xs"
                        maxLength={30}
                    />
                </div>
            )}

            {showRecipient && (
                <>
                    <div className="space-y-1">
                        <Label htmlFor={`${uid}-name`}>Full name</Label>
                        <Input
                            id={`${uid}-name`}
                            value={value.name ?? ""}
                            onChange={(e) => set("name")(e.target.value)}
                            maxLength={120}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor={`${uid}-phone`}>Phone</Label>
                        <Input
                            id={`${uid}-phone`}
                            value={value.phone ?? ""}
                            onChange={(e) => set("phone")(e.target.value)}
                            inputMode="tel"
                            maxLength={20}
                        />
                    </div>
                </>
            )}

            <div className="space-y-1 sm:col-span-2">
                <Label htmlFor={`${uid}-line1`}>Address line 1</Label>
                <Input
                    id={`${uid}-line1`}
                    value={value.line1 ?? ""}
                    onChange={(e) => set("line1")(e.target.value)}
                    maxLength={200}
                />
            </div>

            <div className="space-y-1 sm:col-span-2">
                <Label htmlFor={`${uid}-line2`}>Address line 2 (optional)</Label>
                <Input
                    id={`${uid}-line2`}
                    value={value.line2 ?? ""}
                    onChange={(e) => set("line2")(e.target.value)}
                    maxLength={200}
                />
            </div>

            <div className="space-y-1">
                <Label htmlFor={`${uid}-pincode`}>Pincode</Label>
                <Input
                    id={`${uid}-pincode`}
                    value={value.pincode ?? ""}
                    onChange={(e) => set("pincode")(e.target.value.replace(/\D/gu, "").slice(0, 6))}
                    inputMode="numeric"
                    placeholder="6-digit — city & state auto-fill"
                    maxLength={6}
                />
                {activePincodeInfo ? <p className="text-xs text-muted-foreground">{activePincodeInfo}</p> : null}
            </div>

            <div className="space-y-1">
                <Label htmlFor={`${uid}-locality`}>Locality / area</Label>
                {activeLocalityOptions.length > 0 ? (
                    <div className="space-y-1.5">
                        <Select
                            value={value.locality || "__none__"}
                            onValueChange={handleLocalityChange}
                        >
                            <SelectTrigger id={`${uid}-locality`} className="w-full">
                                <SelectValue placeholder="Select locality" />
                            </SelectTrigger>
                            <SelectContent className="max-h-72">
                                <SelectItem value="__none__">Not listed / other</SelectItem>
                                {displayLocalityOptions.map((l) => (
                                    <SelectItem key={l} value={l}>
                                        {l}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {value.locality === "" && (
                            <Input
                                value={customLocality}
                                onChange={(e) => {
                                    setCustomLocality(e.target.value);
                                    set("locality")(e.target.value);
                                }}
                                placeholder="Type locality / area"
                                maxLength={120}
                                className="text-xs"
                            />
                        )}
                    </div>
                ) : (
                    <Input
                        id={`${uid}-locality`}
                        value={value.locality ?? ""}
                        onChange={(e) => set("locality")(e.target.value)}
                        placeholder="Locality / area"
                        maxLength={120}
                    />
                )}
            </div>

            {activeHasCoverage ? (
                <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor={`${uid}-neighbourhood`}>Neighbourhood (for local delivery)</Label>
                    <Select
                        value={value.neighbourhood || "__none__"}
                        onValueChange={handleNeighbourhoodChange}
                    >
                        <SelectTrigger id={`${uid}-neighbourhood`} className="w-full">
                            <SelectValue placeholder="Select your neighbourhood" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                            <SelectItem value="__none__">Not my area</SelectItem>
                            {activeNeighbourhoodOptions.map((n) => (
                                <SelectItem key={n} value={n}>
                                    {n}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        We deliver locally here — pick your neighbourhood to see the local delivery option.
                    </p>
                </div>
            ) : null}

            <div className="space-y-1">
                <Label htmlFor={`${uid}-city`}>City</Label>
                <Input
                    id={`${uid}-city`}
                    value={value.city ?? ""}
                    onChange={(e) => set("city")(e.target.value)}
                    maxLength={80}
                />
            </div>

            <div className="space-y-1">
                <Label htmlFor={`${uid}-state`}>State</Label>
                <Select value={value.state ?? ""} onValueChange={(v) => set("state")(v)}>
                    <SelectTrigger id={`${uid}-state`} className="w-full">
                        <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                        {INDIA_STATE_NAMES.map((s) => (
                            <SelectItem key={s} value={s}>
                                {s}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}
