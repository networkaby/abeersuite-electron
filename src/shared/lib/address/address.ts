import { z } from "zod";

/**
 * A customer's address book row (PersonAddress) as the screens see it — the
 * office profile, the portal's Addresses page and checkout share this shape and
 * the text helpers below, so the line that prints on a bill is built one way.
 */

export type AddressRow = {
    id: number;
    label: string | null;
    name: string | null;
    phone: string | null;
    line1: string;
    line2: string | null;
    landmark: string | null;
    locality: string | null;
    neighbourhood: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    isPrimary: boolean;
    lastUsedAt: string | Date | null;
};

export const ADDRESS_SELECT = {
    id: true,
    label: true,
    name: true,
    phone: true,
    line1: true,
    line2: true,
    landmark: true,
    locality: true,
    neighbourhood: true,
    city: true,
    state: true,
    pincode: true,
    isPrimary: true,
    lastUsedAt: true,
} as const;

/** Quick labels offered as chips; any other text is allowed. */
export const ADDRESS_LABELS = ["Home", "Office", "Shop"] as const;

const opt = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .nullish()
        .transform((v) => v || null);

/** Only line1 is required — a POS quick customer may have just a village name. */
export const addressSchema = z.object({
    label: opt(30),
    name: opt(120),
    phone: opt(20),
    line1: z.string().trim().min(1, "Enter address line 1").max(200),
    line2: opt(200),
    landmark: opt(120),
    locality: opt(120),
    neighbourhood: opt(120),
    city: opt(80),
    state: opt(80),
    pincode: z
        .string()
        .trim()
        .nullish()
        .transform((v) => v || null)
        .refine((v) => v === null || /^\d{6}$/u.test(v), "PIN code is 6 digits"),
});
export type AddressInput = z.input<typeof addressSchema>;
export type AddressData = z.output<typeof addressSchema>;

export type Parts = {
    line1: string;
    line2?: string | null;
    landmark?: string | null;
    locality?: string | null;
    neighbourhood?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
};

/** The whole address on one line — what Person.address (bills, POS) carries. */
export function formatAddress(a: Parts): string {
    const place = [a.city, a.state].filter(Boolean).join(", ");
    return [
        a.line1,
        a.line2,
        a.landmark && `Near ${a.landmark}`,
        a.neighbourhood,
        a.locality !== a.neighbourhood ? a.locality : null,
        [place, a.pincode].filter(Boolean).join(" - "),
    ]
        .filter((s) => s && s.trim())
        .join(", ");
}

/** "Deliver to Rahim, Abhayapuri 783384" — the short line checkout shows. */
export function shortAddress(a: Parts & Pick<AddressRow, "name">): string {
    return [a.name, [a.locality ?? a.city ?? a.line1, a.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/** Checkout needs PIN, city and state to price delivery; older rows may lack them. */
export const isDeliverable = (a: Pick<AddressRow, "pincode" | "city" | "state">) =>
    !!a.pincode && /^\d{6}$/u.test(a.pincode) && !!a.city && !!a.state;
