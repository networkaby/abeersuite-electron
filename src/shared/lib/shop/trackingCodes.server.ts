import { unstable_cache } from "next/cache";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { normalizeTrackingCodes, type TrackingCodes } from "./trackingCodes";

/** Invalidated by the Tracking Codes save. */
export const TRACKING_CODES_TAG = "tracking-codes";

/**
 * Every shop page reads this, so it is cached — one DB read per hour (or per
 * save) instead of one per visitor. Server-only.
 */
export const loadTrackingCodes = unstable_cache(
    async (): Promise<TrackingCodes> => {
        const od = await prisma.orgDefaults.findUnique({
            where: { id: 1 },
            select: { trackingCodesJson: true },
        });
        return normalizeTrackingCodes(od?.trackingCodesJson);
    },
    ["shop:tracking-codes"],
    { tags: [TRACKING_CODES_TAG], revalidate: 3600 },
);
