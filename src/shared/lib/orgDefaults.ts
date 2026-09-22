import axios from "axios";
import { SHOP_SEASONAL_FALLBACK, type SeasonalHours } from "./hr/seasonalHours";
import { parsePayRules, type PayRules } from "./hr/payRules";

export interface OrgDefaultsData {
    id: number;
    defaultUnitId: number | null;
    /// FK to GstRate master — final fallback in the cascading GST lookup.
    defaultGstRateId: number | null;
    defaultHsnCode: string | null;
    defaultTaxability: string | null;
    defaultSaleCreditPeriod: number | null;
    defaultPurchaseCreditPeriod: number | null;
    defaultCurrencySymbol: string;
    /// Cash note/coin denominations for the POS shift-close counter, high → low.
    cashDenominationsJson: number[];
    /// Office hours — the two solstice openings and the fixed closing, "HH:MM".
    /// Every other day of the year falls between the anchors on a cosine; see
    /// src/shared/lib/hr/seasonalHours.ts.
    dutySummerStart: string;
    dutyWinterStart: string;
    dutyEnd: string;
    /// Days the whole shop is closed, 0 = Sunday.
    weeklyOff: number[];
    /// How time turns into money — overtime, weekend, absence, lateness.
    /// Null on a row nobody has saved yet; read it through `getPayRules()`.
    hrPayRulesJson: PayRules | null;
}

// Module-level cache — populated once per browser session on first call.
let cache: OrgDefaultsData | null = null;

export async function getOrgDefaults(): Promise<OrgDefaultsData> {
    if (cache) return cache;
    const { data } = await axios.get<OrgDefaultsData>("/api/settings/org-defaults");
    cache = data;
    return data;
}

/** Call this after a successful PATCH to OrgDefaults so the cache stays fresh. */
export function invalidateOrgDefaultsCache() {
    cache = null;
}

/**
 * The shop's office hours in the shape the seasonal curve wants.
 *
 * A helper rather than three reads at every call site: the curve needs all three
 * together, and an older cached row — from a browser that loaded before the
 * columns existed — would otherwise put `undefined` into the maths and produce a
 * time of "NaN:NaN". Falling back per field keeps that impossible.
 */
export async function getSeasonalHours(): Promise<SeasonalHours> {
    const d = await getOrgDefaults();
    return {
        summerStart: d.dutySummerStart || SHOP_SEASONAL_FALLBACK.summerStart,
        winterStart: d.dutyWinterStart || SHOP_SEASONAL_FALLBACK.winterStart,
        end:         d.dutyEnd         || SHOP_SEASONAL_FALLBACK.end,
    };
}

/**
 * The shop's pay rules, with every missing field filled from the code defaults.
 *
 * Always through here, never off the raw column: a row saved before a rule
 * existed, or an older browser's cached copy, would otherwise put `undefined`
 * into an arithmetic that ends on somebody's payslip.
 */
export async function getPayRules(): Promise<PayRules> {
    const d = await getOrgDefaults();
    return parsePayRules(d.hrPayRulesJson);
}
