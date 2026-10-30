"use client";

import { useState } from "react";
import { MapPin, Plus } from "lucide-react";
import { formatAddress, isDeliverable, shortAddress, type AddressRow } from "@/shared/lib/address/address";
import type { useShopCheckout } from "./useShopCheckout";

type Checkout = Pick<ReturnType<typeof useShopCheckout>, "savedAddresses" | "addressId" | "pickAddress" | "addressOpen" | "setAddressOpen" | "address">;

/**
 * "Deliver to Rahim, Abhayapuri 783384 · Change" — the top of the address step
 * on the website and in the app. Change lists every saved address plus "Add a
 * new address"; Edit opens the form below on the chosen one. Shows nothing for
 * a guest or a customer with no saved address (the form is all they need).
 */
export default function CheckoutAddressPicker({ c }: { c: Checkout }) {
    const [choosing, setChoosing] = useState(false);
    const saved = c.savedAddresses ?? [];
    if (saved.length === 0) return null;

    const pick = (id: number | null) => {
        c.pickAddress(id);
        setChoosing(false);
    };

    if (choosing) {
        return (
            <div className="space-y-2">
                <p className="text-sm font-medium">Deliver to</p>
                {saved.map((a: AddressRow) => (
                    <button
                        key={a.id}
                        type="button"
                        onClick={() => pick(a.id)}
                        className={`flex w-full items-start gap-2 rounded-lg border p-3 text-left ${a.id === c.addressId ? "border-primary ring-1 ring-primary" : ""}`}
                    >
                        <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                            <span className="block text-sm font-medium">
                                {a.label || "Address"}
                                {a.name && <span className="font-normal text-muted-foreground"> · {a.name}</span>}
                            </span>
                            <span className="block text-xs text-muted-foreground">{formatAddress(a)}</span>
                            {!isDeliverable(a) && <span className="block text-xs text-amber-600 dark:text-amber-400">Needs PIN, city and state — you can add them next.</span>}
                        </span>
                    </button>
                ))}
                <button type="button" onClick={() => pick(null)} className="flex w-full items-center gap-2 rounded-lg border border-dashed p-3 text-sm font-medium text-primary">
                    <Plus className="size-4" /> Add a new address
                </button>
            </div>
        );
    }

    const current = saved.find((a) => a.id === c.addressId);
    return (
        <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="min-w-0">
                <p className="text-sm">
                    Deliver to <span className="font-semibold">{current ? shortAddress({ ...current, name: c.address.name || current.name }) : "a new address"}</span>
                </p>
                {current && <p className="truncate text-xs text-muted-foreground">{formatAddress(current)}</p>}
            </div>
            <div className="flex shrink-0 gap-3 text-sm font-medium text-primary">
                {current && !c.addressOpen && (
                    <button type="button" onClick={() => c.setAddressOpen(true)}>
                        Edit
                    </button>
                )}
                <button type="button" onClick={() => setChoosing(true)}>
                    Change
                </button>
            </div>
        </div>
    );
}
