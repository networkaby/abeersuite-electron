import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

/**
 * Marketing unsubscribe. The link carries the address and an HMAC of it
 * (AUTH_SECRET), so nobody can unsubscribe someone else by typing their email,
 * and the page needs no sign-in. Served by /portal/unsubscribe.
 */

function sign(email: string): string {
    const s = process.env.AUTH_SECRET;
    if (!s) throw new Error("AUTH_SECRET is not set — unsubscribe link cannot be signed.");
    return createHmac("sha256", s).update(`unsubscribe:${email}`).digest("base64url").slice(0, 22);
}

const norm = (email: string) => email.trim().toLowerCase();

export function unsubscribeUrl(email: string): string {
    const e = norm(email);
    return `${COMPANY_DETAILS.sites.shop}/portal/unsubscribe?e=${encodeURIComponent(e)}&t=${sign(e)}`;
}

export function checkUnsubscribeToken(email: string, token: string): boolean {
    const want = Buffer.from(sign(norm(email)));
    const got = Buffer.from(token);
    return want.length === got.length && timingSafeEqual(want, got);
}

export async function optOut(email: string): Promise<void> {
    const e = norm(email);
    await prisma.emailOptOut.upsert({ where: { email: e }, create: { email: e }, update: {} });
}

export async function isOptedOut(email: string): Promise<boolean> {
    return (await prisma.emailOptOut.count({ where: { email: norm(email) } })) > 0;
}
