"use client";

import { useEffect, useId, useState } from "react";
import axios from "axios";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INDIAN_STATES } from "@/shared/lib/gst/indianStates";
import { ADDRESS_LABELS, type AddressInput } from "@/shared/lib/address/address";

export type AddressDraft = {
    label: string;
    name: string;
    phone: string;
    line1: string;
    line2: string;
    landmark: string;
    locality: string;
    city: string;
    state: string;
    pincode: string;
};

export const EMPTY_ADDRESS_DRAFT: AddressDraft = { label: "", name: "", phone: "", line1: "", line2: "", landmark: "", locality: "", city: "", state: "", pincode: "" };

/** A saved row → the form's strings. */
export const toDraft = (a: Partial<Record<keyof AddressDraft, string | null>>): AddressDraft =>
    Object.fromEntries(Object.keys(EMPTY_ADDRESS_DRAFT).map((k) => [k, a[k as keyof AddressDraft] ?? ""])) as AddressDraft;

/** The form's strings → what the API takes (blank = null; the server trims). */
export const fromDraft = (d: AddressDraft): AddressInput => ({ ...d });

const STATES = INDIAN_STATES.filter((s) => Number(s.code) < 97).map((s) => s.name);

/**
 * The address fields, one layout for office, portal and checkout. A 6-digit PIN
 * fills city and state (India Post, via /api/shop/pincode) and offers the post
 * offices as locality suggestions — only into blank boxes, never over typing.
 */
export default function AddressForm({
    value,
    onChange,
    showRecipient = false,
}: {
    value: AddressDraft;
    onChange: (next: AddressDraft) => void;
    /** Receiver name + phone — on the customer's own address book, not the office. */
    showRecipient?: boolean;
}) {
    const uid = useId();
    // The last PIN looked up and what India Post said; read only while it matches.
    const [lookup, setLookup] = useState<{ pin: string; note: string; localities: string[] } | null>(null);
    const set = (k: keyof AddressDraft) => (v: string) => onChange({ ...value, [k]: v });

    const pin = value.pincode;
    const pinValid = /^\d{6}$/u.test(pin);
    const current = pinValid && lookup?.pin === pin ? lookup : null;
    const pinNote = !pinValid ? "" : (current?.note ?? "Finding the area…");
    const localities = current?.localities ?? [];

    useEffect(() => {
        if (!pinValid) return;
        let live = true;
        axios
            .get<{ ok: boolean; city?: string; state?: string; localities?: string[] }>(`/api/shop/pincode/${pin}`)
            .then(({ data }) => {
                if (!live) return;
                if (!data.ok) {
                    setLookup({ pin, note: "PIN not found — type city and state", localities: [] });
                    return;
                }
                setLookup({ pin, note: `${data.city}, ${data.state}`, localities: data.localities ?? [] });
                // Fill blanks only — a staff or customer correction stays.
                onChange({ ...value, city: value.city || data.city || "", state: value.state || data.state || "" });
            })
            .catch(() => live && setLookup({ pin, note: "", localities: [] }));
        return () => {
            live = false;
        };
        // Runs per PIN only; `value` is read at that moment on purpose.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pin, pinValid]);

    const box = (k: keyof AddressDraft, label: string, extra?: React.ComponentProps<typeof Input>) => (
        <div className="space-y-1">
            <Label htmlFor={`${uid}-${k}`} className="text-xs">
                {label}
            </Label>
            <Input id={`${uid}-${k}`} value={value[k]} onChange={(e) => set(k)(e.target.value)} {...extra} />
        </div>
    );

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
                {ADDRESS_LABELS.map((l) => (
                    <button
                        key={l}
                        type="button"
                        onClick={() => set("label")(value.label === l ? "" : l)}
                        className={`rounded-full border px-2.5 py-0.5 text-xs ${value.label === l ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"}`}
                    >
                        {l}
                    </button>
                ))}
                <Input value={value.label} onChange={(e) => set("label")(e.target.value)} placeholder="or a name" className="h-7 w-28 text-xs" maxLength={30} />
            </div>
            {showRecipient && (
                <div className="grid gap-3 sm:grid-cols-2">
                    {box("name", "Receiver name (blank = you)", { maxLength: 120 })}
                    {box("phone", "Receiver phone", { inputMode: "tel", maxLength: 20 })}
                </div>
            )}
            {box("line1", "House / flat / building, street", { maxLength: 200 })}
            <div className="grid gap-3 sm:grid-cols-2">
                {box("line2", "Area / road (optional)", { maxLength: 200 })}
                {box("landmark", "Landmark (optional)", { maxLength: 120, placeholder: "Near …" })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                    <Label htmlFor={`${uid}-pincode`} className="text-xs">
                        PIN code
                    </Label>
                    <Input
                        id={`${uid}-pincode`}
                        value={value.pincode}
                        onChange={(e) => set("pincode")(e.target.value.replace(/\D/gu, "").slice(0, 6))}
                        inputMode="numeric"
                        placeholder="6 digits — fills city & state"
                    />
                    {pinNote && <p className="text-xs text-muted-foreground">{pinNote}</p>}
                </div>
                <div className="space-y-1">
                    <Label htmlFor={`${uid}-locality`} className="text-xs">
                        Locality / village
                    </Label>
                    <Input id={`${uid}-locality`} list={`${uid}-localities`} value={value.locality} onChange={(e) => set("locality")(e.target.value)} maxLength={120} />
                    <datalist id={`${uid}-localities`}>
                        {localities.map((l) => (
                            <option key={l} value={l} />
                        ))}
                    </datalist>
                </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                {box("city", "City / district", { maxLength: 80 })}
                <div className="space-y-1">
                    <Label htmlFor={`${uid}-state`} className="text-xs">
                        State
                    </Label>
                    <Input id={`${uid}-state`} list={`${uid}-states`} value={value.state} onChange={(e) => set("state")(e.target.value)} maxLength={80} />
                    <datalist id={`${uid}-states`}>
                        {STATES.map((s) => (
                            <option key={s} value={s} />
                        ))}
                    </datalist>
                </div>
            </div>
        </div>
    );
}
