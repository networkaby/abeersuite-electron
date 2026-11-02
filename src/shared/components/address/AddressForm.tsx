"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
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
import { usePincodeLookup, type AddressUpdate } from "./usePincodeLookup";

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
}

/**
 * Universal address form: one set of fields and one layout for the office profile,
 * POS, customer portal and both checkouts (web & app). Add or remove a field here and
 * every screen follows. POS quick create on the bill keeps its own one address box.
 *
 * A 6-digit PIN fills empty City / State / Locality boxes and lists our local-delivery
 * neighbourhoods (usePincodeLookup); a box already typed changes only on "Use".
 */
export default function AddressForm({ value, onChange, showRecipient = false, showLabelChips = true }: AddressFormProps) {
    const uid = useId();

    // A PIN answer can land after more typing: apply it to the newest address, not
    // to the one on screen when the lookup started.
    const latest = useRef(value);
    const onChangeRef = useRef(onChange);
    useLayoutEffect(() => {
        latest.current = value;
        onChangeRef.current = onChange;
    });
    const update = useCallback<AddressUpdate>((fn) => {
        const next = fn(latest.current);
        latest.current = next;
        onChangeRef.current(next);
    }, []);

    const lookup = usePincodeLookup(value, update);
    const set = (k: keyof AddressDraft) => (v: string) => update((a) => ({ ...a, [k]: v }));

    // "Not listed / other" picked: the typing box stays open while the customer
    // types, until a listed locality is picked again.
    const [otherLocality, setOtherLocality] = useState(false);
    const typingLocality = otherLocality || !value.locality;
    const localityChoices = [...new Set([...lookup.localityOptions, ...(value.locality ? [value.locality] : [])])];

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

            <div className="space-y-1 sm:col-span-2">
                <Label htmlFor={`${uid}-landmark`}>Landmark (optional)</Label>
                <Input
                    id={`${uid}-landmark`}
                    value={value.landmark ?? ""}
                    onChange={(e) => set("landmark")(e.target.value)}
                    placeholder="Near …"
                    maxLength={120}
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
                {lookup.suggestion ? (
                    <p className="text-xs text-muted-foreground">
                        PIN says {[lookup.suggestion.city, lookup.suggestion.state].filter(Boolean).join(", ")} ·{" "}
                        <button type="button" onClick={lookup.applySuggestion} className="font-medium text-primary hover:underline">
                            Use
                        </button>
                    </p>
                ) : lookup.pincodeInfo ? (
                    <p className="text-xs text-muted-foreground">{lookup.pincodeInfo}</p>
                ) : null}
            </div>

            <div className="space-y-1">
                <Label htmlFor={`${uid}-locality`}>Locality / area</Label>
                {lookup.localityOptions.length > 0 ? (
                    <div className="space-y-1.5">
                        <Select
                            value={typingLocality ? "__none__" : value.locality}
                            onValueChange={(v) => {
                                setOtherLocality(v === "__none__");
                                lookup.onLocalityChange(v === "__none__" ? "" : v);
                            }}
                        >
                            <SelectTrigger id={`${uid}-locality`} className="w-full">
                                <SelectValue placeholder="Select locality" />
                            </SelectTrigger>
                            <SelectContent className="max-h-72">
                                <SelectItem value="__none__">Not listed / other</SelectItem>
                                {localityChoices.map((l) => (
                                    <SelectItem key={l} value={l}>
                                        {l}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {typingLocality && (
                            <Input
                                value={value.locality ?? ""}
                                onChange={(e) => {
                                    setOtherLocality(true);
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

            {lookup.hasCoverage ? (
                <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor={`${uid}-neighbourhood`}>Neighbourhood (for local delivery)</Label>
                    <Select
                        value={value.neighbourhood || "__none__"}
                        onValueChange={(v) => {
                            // Its parent locality fills in from the list, so the typing box closes.
                            if (v !== "__none__") setOtherLocality(false);
                            lookup.onNeighbourhoodChange(v === "__none__" ? "" : v);
                        }}
                    >
                        <SelectTrigger id={`${uid}-neighbourhood`} className="w-full">
                            <SelectValue placeholder="Select your neighbourhood" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                            <SelectItem value="__none__">Not my area</SelectItem>
                            {lookup.neighbourhoodOptions.map((n) => (
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
