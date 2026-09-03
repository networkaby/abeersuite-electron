import { z } from "zod";
import { OFFLINE_POLICY_KEYS, type OfflinePolicies } from "@/shared/lib/accountancy/offlineVoucherSafety";

// OfflinePolicy (singleton) — what a counter may write while cut off from Supabase.
// The keys are derived from DEFAULT_OFFLINE_POLICIES rather than retyped, so adding a
// toggle in one place cannot leave the API silently rejecting it. Strict, so a typo'd
// key is a 400 rather than a setting that appears to save and then does nothing —
// which is the exact failure this whole feature is fixing.
type PolicyShape = { [K in keyof OfflinePolicies]: z.ZodOptional<z.ZodBoolean> };

const policyShape = Object.fromEntries(
    OFFLINE_POLICY_KEYS.map((key) => [key, z.boolean().optional()]),
) as PolicyShape;

export const offlinePolicyUpdateSchema = z.strictObject(policyShape);

export type OfflinePolicyUpdateInput = z.infer<typeof offlinePolicyUpdateSchema>;
