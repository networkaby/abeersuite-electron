import axios from "axios";

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
