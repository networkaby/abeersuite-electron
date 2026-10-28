import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { lockSecret, unlockSecret, hasSharedSecret } from "@/shared/lib/ai/secretBox";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { mediaLink } from "@/modules/message/lib/customerMessages";
import { googleAutoBlock, postCaption } from "@/modules/campaigns/lib/post";

/**
 * Google Business Profile — posting a Post to the shop's listing through
 * Google's API, once the owner has connected it on Campaigns → Channels.
 *
 * One OAuth client (GOOGLE_BUSINESS_CLIENT_ID / _SECRET, Cloud project with the
 * Business Profile API approved). Connect signs in the listing's owner and keeps
 * a refresh token (GoogleBusinessLink, locked with AI_KEY_SECRET); every call
 * swaps it for a short access token. Connecting always happens on the office
 * site — Google sends the browser back to the redirect URL registered there.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
// Posts (localPosts) are still only on the old v4 API.
const POSTS_API = "https://mybusiness.googleapis.com/v4";
const SCOPES = ["https://www.googleapis.com/auth/business.manage", "openid", "email"];

export const GOOGLE_LINK_ID = 1;

const env = () => ({
    clientId: process.env.GOOGLE_BUSINESS_CLIENT_ID?.trim() || "",
    clientSecret: process.env.GOOGLE_BUSINESS_CLIENT_SECRET?.trim() || "",
});

/** Where Google sends the browser back; must match the OAuth client's redirect URL. */
export const googleRedirectUrl = () =>
    process.env.GOOGLE_BUSINESS_REDIRECT_URL?.trim() || `${COMPANY_DETAILS.sites.office}/api/campaigns/google/callback`;

/** Why this server cannot connect Google, or null when it can. */
export function googleSetupProblem(): string | null {
    const { clientId, clientSecret } = env();
    if (!clientId || !clientSecret) return "GOOGLE_BUSINESS_CLIENT_ID and GOOGLE_BUSINESS_CLIENT_SECRET are not set on this server.";
    if (!hasSharedSecret()) return "AI_KEY_SECRET is not set on this server — it locks the saved Google access.";
    return null;
}

export function googleAuthUrl(state: string): string {
    const q = new URLSearchParams({
        client_id: env().clientId,
        redirect_uri: googleRedirectUrl(),
        response_type: "code",
        scope: SCOPES.join(" "),
        // offline + consent: Google hands a refresh token every time, not just the first.
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state,
    });
    return `${AUTH_URL}?${q}`;
}

type TokenReply = { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error?: string; error_description?: string };

async function tokenCall(body: Record<string, string>): Promise<TokenReply> {
    const { clientId, clientSecret } = env();
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...body }),
    });
    return (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as TokenReply;
}

/** The email inside Google's id_token — read only, it came straight from Google over TLS. */
function emailOf(idToken?: string): string | null {
    try {
        const part = idToken?.split(".")[1];
        return part ? (JSON.parse(Buffer.from(part, "base64url").toString("utf8")).email as string) ?? null : null;
    } catch {
        return null;
    }
}

/**
 * Swap the code Google sent back for a refresh token and save the link. A new
 * sign-in keeps the picked location only when it is the same Google account.
 */
export async function saveGoogleConnection(code: string, user: { id: number; name: string | null }): Promise<string | null> {
    const t = await tokenCall({ code, grant_type: "authorization_code", redirect_uri: googleRedirectUrl() });
    if (!t.refresh_token) return t.error_description || t.error || "Google sent no lasting access — try Connect again.";
    const googleEmail = emailOf(t.id_token);
    const old = await prisma.googleBusinessLink.findUnique({ where: { id: GOOGLE_LINK_ID }, select: { googleEmail: true } });
    const keepPlace = old?.googleEmail && old.googleEmail === googleEmail;
    const data = {
        refreshTokenEnc: lockSecret(t.refresh_token, "shared"),
        googleEmail,
        connectedById: user.id,
        connectedByName: user.name,
        lastError: null,
        ...(keepPlace ? {} : { accountName: null, locationName: null, locationTitle: null }),
    };
    await prisma.googleBusinessLink.upsert({ where: { id: GOOGLE_LINK_ID }, create: { id: GOOGLE_LINK_ID, ...data }, update: data });
    cachedToken = null;
    return null;
}

/** Forget the connection, and tell Google to drop the access too (best effort). */
export async function disconnectGoogle(): Promise<void> {
    const row = await prisma.googleBusinessLink.findUnique({ where: { id: GOOGLE_LINK_ID }, select: { refreshTokenEnc: true } });
    const token = row && unlockSecret(row.refreshTokenEnc, "shared");
    if (token) await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
    await prisma.googleBusinessLink.deleteMany({ where: { id: GOOGLE_LINK_ID } });
    cachedToken = null;
}

export class GoogleError extends Error {}

// One access token per server instance, until a minute before it expires.
let cachedToken: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
    if (cachedToken && cachedToken.until > Date.now()) return cachedToken.token;
    const problem = googleSetupProblem();
    if (problem) throw new GoogleError(problem);
    const row = await prisma.googleBusinessLink.findUnique({ where: { id: GOOGLE_LINK_ID }, select: { refreshTokenEnc: true } });
    if (!row) throw new GoogleError("Google Business Profile is not connected — Campaigns → Channels → Connect.");
    const refresh = unlockSecret(row.refreshTokenEnc, "shared");
    if (!refresh) throw new GoogleError("The saved Google access cannot be opened (AI_KEY_SECRET changed?) — connect again.");
    const t = await tokenCall({ refresh_token: refresh, grant_type: "refresh_token" });
    if (!t.access_token) {
        const why =
            t.error === "invalid_grant"
                ? "Google access was taken back or has expired — connect again on Campaigns → Channels."
                : `Google refused the access: ${t.error_description || t.error}`;
        // Reached from GETs (the listing picker), which a counter never relays — so on a
        // counter this would write from a read, possibly into its replica. The office notes it.
        if (!IS_COUNTER_PC) await noteGoogleError(why);
        throw new GoogleError(why);
    }
    cachedToken = { token: t.access_token, until: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000 };
    return t.access_token;
}

/** Best effort: a failed note must never replace the Google message the user should see. */
const noteGoogleError = (lastError: string | null) =>
    prisma.googleBusinessLink
        .updateMany({ where: { id: GOOGLE_LINK_ID }, data: { lastError } })
        .catch((e) => console.warn("[googleBusiness] could not note lastError:", e));

/** Every v4 call (posts, reviews) goes under this base. */
export const GOOGLE_V4_API = POSTS_API;

/** The picked listing as v4 names it ("accounts/1/locations/2"), or null before one is picked. */
export async function googleListingParent(): Promise<string | null> {
    const link = await prisma.googleBusinessLink.findUnique({ where: { id: GOOGLE_LINK_ID }, select: { accountName: true, locationName: true } });
    return link?.accountName && link.locationName ? `${link.accountName}/${link.locationName}` : null;
}

export async function googleApi<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...init?.headers },
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
    if (!res.ok) {
        const msg = body.error?.message || `HTTP ${res.status}`;
        // 429 with quota 0 = the Cloud project is not (yet) allowed this API.
        throw new GoogleError(res.status === 429 ? `Google says too many requests or no quota: ${msg}` : `Google: ${msg}`);
    }
    return body;
}

export type GoogleLocation = { accountName: string; locationName: string; title: string; address: string | null };

/** Every listing the connected Google account can manage, across its accounts. */
export async function listGoogleLocations(): Promise<GoogleLocation[]> {
    const { accounts = [] } = await googleApi<{ accounts?: { name: string }[] }>(`${ACCOUNTS_API}/accounts?pageSize=20`);
    const out: GoogleLocation[] = [];
    for (const a of accounts) {
        const { locations = [] } = await googleApi<{
            locations?: { name: string; title?: string; storefrontAddress?: { addressLines?: string[]; locality?: string } }[];
        }>(`${INFO_API}/${a.name}/locations?pageSize=100&readMask=name,title,storefrontAddress`);
        for (const l of locations) {
            const addr = l.storefrontAddress;
            out.push({
                accountName: a.name,
                locationName: l.name,
                title: l.title ?? l.name,
                address: addr ? [...(addr.addressLines ?? []), addr.locality].filter(Boolean).join(", ") || null : null,
            });
        }
    }
    return out;
}

/** Connection as the Channels page shows it — never the token. */
export async function googleStatus() {
    const row = await prisma.googleBusinessLink.findUnique({
        where: { id: GOOGLE_LINK_ID },
        select: { googleEmail: true, locationName: true, locationTitle: true, connectedByName: true, lastError: true, updatedAt: true },
    });
    return { setupProblem: googleSetupProblem(), connected: !!row, ...row, ready: !!row?.locationName && !googleSetupProblem() };
}

/** Is Google posting fully set up (connected and a listing picked)? */
export async function googleReady(): Promise<boolean> {
    if (googleSetupProblem()) return false;
    const row = await prisma.googleBusinessLink.findUnique({ where: { id: GOOGLE_LINK_ID }, select: { locationName: true } });
    return !!row?.locationName;
}

type PostForGoogle = {
    caption: string;
    link: string | null;
    googleType: string;
    googleButton: string | null;
    mediaKey: string | null;
    mediaType: string | null;
};

/**
 * Put one post up on the listing as a Google "Update". Returns the post's
 * public link on Google when it gives one. Throws GoogleError with a reason
 * staff can read; the reason is also kept on the link for the Channels page.
 */
export async function postToGoogle(p: PostForGoogle): Promise<string | null> {
    const block = googleAutoBlock(p);
    if (block) throw new GoogleError(block);
    const parent = await googleListingParent();
    if (!parent) throw new GoogleError("Pick the shop's listing on Campaigns → Channels first.");

    const shop = COMPANY_DETAILS.sites.shop;
    const body: Record<string, unknown> = {
        languageCode: "en-IN",
        topicType: "STANDARD",
        summary: postCaption(p, shop),
    };
    if (p.googleButton) {
        // Call now dials the listing's own number; every other button opens the post's shop page.
        body.callToAction = p.googleButton === "CALL" ? { actionType: "CALL" } : { actionType: p.googleButton, url: `${shop}${p.link ?? ""}` };
    }
    if (p.mediaKey) {
        // Google fetches the photo itself, once, while the signed link is still valid.
        const url = mediaLink(p.mediaKey);
        if (!url) throw new GoogleError("File storage (R2) is not set up on this server, so Google cannot fetch the photo.");
        body.media = [{ mediaFormat: "PHOTO", sourceUrl: url }];
    }

    try {
        const made = await googleApi<{ searchUrl?: string }>(`${POSTS_API}/${parent}/localPosts`, { method: "POST", body: JSON.stringify(body) });
        await noteGoogleError(null);
        return made.searchUrl ?? null;
    } catch (e) {
        if (e instanceof GoogleError) await noteGoogleError(e.message);
        throw e;
    }
}
