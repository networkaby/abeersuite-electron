/**
 * Splits a single tax amount into CGST + SGST (intra-state) or IGST
 * (inter-state) based on the seller-state vs buyer-state comparison.
 *
 * Pure — no Prisma, no React. Safe to call from anywhere (API routes,
 * client components, print components).
 *
 * Indian GST §10 (place of supply for goods, where movement is involved):
 *   • Place of supply = seller state → intra-state, charge CGST + SGST.
 *   • Place of supply ≠ seller state → inter-state, charge IGST.
 *
 * Rounding: half of the tax amount goes each way for INTRA. Any remainder
 * paise (e.g. ₹0.01 on an odd total) attaches to CGST so the two legs sum
 * exactly to the input — no off-by-one drift between the GL entry and the
 * printed invoice.
 */

import { round2 } from "@/shared/lib/format";

export type GstSplit =
    | {
          kind:        "INTRA";
          sellerState: string;
          buyerState:  string;
          cgst:        number;
          sgst:        number;
          igst:        0;
      }
    | {
          kind:        "INTER";
          sellerState: string;
          buyerState:  string;
          cgst:        0;
          sgst:        0;
          igst:        number;
      };

export function isInterState(sellerStateCode: string, buyerStateCode: string): boolean {
    const a = (sellerStateCode || "").trim();
    const b = (buyerStateCode  || "").trim();
    if (!a || !b) return false; // missing data → safe default = same state
    return a !== b;
}

/**
 * Extract state code from the first 2 chars of a GSTIN. Returns "" for
 * empty / too-short input. The format is "<2 state-code digits><10 PAN
 * chars><1 entity><1 check digit><1 Z>" — 15 chars total.
 */
export function gstinDerivedStateCode(gstin: string | null | undefined): string {
    if (!gstin) return "";
    const trimmed = gstin.trim();
    return trimmed.length >= 2 ? trimmed.slice(0, 2) : "";
}

export function computeGstSplit(args: {
    taxAmount:       number;
    sellerStateCode: string;
    buyerStateCode:  string;
}): GstSplit {
    const tax    = Math.max(0, args.taxAmount);
    const seller = (args.sellerStateCode || "").trim();
    const buyer  = (args.buyerStateCode  || "").trim();

    if (isInterState(seller, buyer)) {
        return {
            kind:        "INTER",
            sellerState: seller,
            buyerState:  buyer,
            cgst:        0,
            sgst:        0,
            igst:        round2(tax),
        };
    }

    // INTRA — split tax exactly in half; pin the remainder paise to CGST so
    // (cgst + sgst) === input tax to two decimal places.
    const halfPaise = Math.round((tax * 100) / 2);  // SGST half (lower)
    const sgst      = halfPaise / 100;
    const cgst      = round2(tax - sgst);

    return {
        kind:        "INTRA",
        sellerState: seller,
        buyerState:  buyer,
        cgst,
        sgst,
        igst:        0,
    };
}
