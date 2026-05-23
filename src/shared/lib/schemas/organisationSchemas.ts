import { z } from "zod";

const txt = (max: number) => z.string().max(max).optional();

/**
 * PATCH body for `/api/settings/organisation`. All fields optional so the
 * UI can save a single-field update without re-sending the whole row.
 * Hard caps mirror typical Indian-business field lengths plus comfortable
 * headroom — exact constraints (15-char GSTIN, 10-char PAN, 6-digit PIN)
 * are checked separately so we can keep the input lenient on whitespace.
 */
export const organisationUpdateSchema = z.object({
    brandName:    txt(120),
    legalName:    txt(160),
    tagline:      txt(200),
    logoUrl:      txt(500),

    addressLine1: txt(160),
    addressLine2: txt(160),
    city:         txt(80),
    state:        txt(80),
    pinCode:      txt(20),
    country:      txt(80),

    gstin:        txt(15),
    pan:          txt(10),
    gstStateCode: txt(2),

    email:        txt(160),
    supportEmail: txt(160),
    phone:        txt(40),
    whatsapp:     txt(40),
    siteUrl:      txt(200),
    hours:        txt(120),
});

export type OrganisationUpdateInput = z.infer<typeof organisationUpdateSchema>;
