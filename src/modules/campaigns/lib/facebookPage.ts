import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { lockSecret, unlockSecret, hasSharedSecret } from "@/shared/lib/ai/secretBox";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { mediaLink } from "@/modules/message/lib/customerMessages";
import { facebookAutoBlock, postCaption } from "@/modules/campaigns/lib/post";

/**
 * Facebook Page — posting a Post to the shop's page through Meta's Graph API,
 * once it is connected on Campaigns → Channels. The page's linked Instagram
 * business account rides the same login (instagram.ts).
 *
 * The shop's own Meta app (META_APP_ID / META_APP_SECRET — the one Facebook
 * login already uses) with Facebook Login's redirect URL set to the callback.
 * Connect signs in a page admin, swaps the code for a long-lived user token
 * (~60 days) and keeps it to list the pages; picking one stores that page's own
 * token, which does not expire while the admin keeps the access. Both are
 * locked with AI_KEY_SECRET. While the app is in development mode only its own
 * admins / developers can connect — enough for the shop's page, no app review.
 */

export const GRAPH = "https://graph.facebook.com/v21.0";
const AUTH_URL = "https://www.facebook.com/v21.0/dialog/oauth";
const SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"];

export const FACEBOOK_LINK_ID = 1;

const env = () => ({
    appId: process.env.META_APP_ID?.trim() || "",
    appSecret: process.env.META_APP_SECRET?.trim() || "",
});

/** Where Facebook sends the browser back; must be a Valid OAuth Redirect URI on the app. */
export const facebookRedirectUrl = () =>
    process.env.FACEBOOK_REDIRECT_URL?.trim() || `${COMPANY_DETAILS.sites.office}/api/campaigns/facebook/callback`;

/** Why this server cannot connect Facebook, or null when it can. */
export function facebookSetupProblem(): string | null {
    const { appId, appSecret } = env();
    if (!appId || !appSecret) return "META_APP_ID and META_APP_SECRET are not set on this server.";
    if (!hasSharedSecret()) return "AI_KEY_SECRET is not set on this server — it locks the saved Facebook access.";
    return null;
}

export function facebookAuthUrl(state: string): string {
    const q = new URLSearchParams({
        client_id: env().appId,
        redirect_uri: facebookRedirectUrl(),
        response_type: "code",
        scope: SCOPES.join(","),
        // Ask again for any permission an earlier Connect was refused.
        auth_type: "rerequest",
        state,
    });
    return `${AUTH_URL}?${q}`;
}

export class FacebookError extends Error {}

type GraphError = { error?: { message?: string; code?: number; type?: string } };

/** One Graph call; a refusal becomes a FacebookError with Facebook's own words. */
export async function graph<T>(path: string, init?: { method?: string; params?: Record<string, string> }): Promise<T> {
    const q = new URLSearchParams(init?.params);
    const post = init?.method === "POST";
    const res = await fetch(post ? `${GRAPH}${path}` : `${GRAPH}${path}?${q}`, {
        method: init?.method ?? "GET",
        ...(post ? { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: q } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as T & GraphError;
    if (!res.ok || body.error) {
        const e = body.error;
        // 190 = the access token expired or was taken back.
        if (e?.code === 190) throw new FacebookError("Facebook access was taken back or has expired — connect again on Campaigns → Channels.");
        throw new FacebookError(`Facebook: ${e?.message || `HTTP ${res.status}`}`);
    }
    return body;
}

/** Best effort: a failed note must never replace the Facebook message the user should see. */
export const noteFacebookError = (lastError: string | null) =>
    prisma.facebookPageLink
        .updateMany({ where: { id: FACEBOOK_LINK_ID }, data: { lastError } })
        .catch((e) => console.warn("[facebookPage] could not note lastError:", e));

/**
 * Swap the code Facebook sent back for a long-lived user token and save the
 * link. A new sign-in keeps the picked page only when it is the same person.
 */
export async function saveFacebookConnection(code: string, user: { id: number; name: string | null }): Promise<string | null> {
    const { appId, appSecret } = env();
    try {
        const short = await graph<{ access_token?: string }>("/oauth/access_token", {
            params: { client_id: appId, client_secret: appSecret, redirect_uri: facebookRedirectUrl(), code },
        });
        if (!short.access_token) return "Facebook sent no access — try Connect again.";
        const long = await graph<{ access_token?: string }>("/oauth/access_token", {
            params: { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: short.access_token },
        });
        const token = long.access_token ?? short.access_token;
        const me = await graph<{ id: string; name?: string }>("/me", { params: { fields: "id,name", access_token: token } });
        const old = await prisma.facebookPageLink.findUnique({ where: { id: FACEBOOK_LINK_ID }, select: { fbUserName: true } });
        const keepPage = old?.fbUserName && old.fbUserName === (me.name ?? null);
        const data = {
            userTokenEnc: lockSecret(token, "shared"),
            fbUserName: me.name ?? null,
            connectedById: user.id,
            connectedByName: user.name,
            lastError: null,
            ...(keepPage ? {} : { pageId: null, pageName: null, pageTokenEnc: null, igUserId: null, igUsername: null }),
        };
        await prisma.facebookPageLink.upsert({ where: { id: FACEBOOK_LINK_ID }, create: { id: FACEBOOK_LINK_ID, ...data }, update: data });
        return null;
    } catch (e) {
        if (e instanceof FacebookError) return e.message;
        throw e;
    }
}

/** Forget the connection, and tell Facebook to drop the app's access too (best effort). */
export async function disconnectFacebook(): Promise<void> {
    const row = await prisma.facebookPageLink.findUnique({ where: { id: FACEBOOK_LINK_ID }, select: { userTokenEnc: true } });
    const token = row && unlockSecret(row.userTokenEnc, "shared");
    if (token) await graph("/me/permissions", { method: "POST", params: { method: "delete", access_token: token } }).catch(() => undefined);
    await prisma.facebookPageLink.deleteMany({ where: { id: FACEBOOK_LINK_ID } });
}

export type FacebookPage = { id: string; name: string; category: string | null; canPost: boolean };
type PageRow = { id: string; name: string; category?: string; access_token?: string; tasks?: string[] };

async function userToken(): Promise<string> {
    const problem = facebookSetupProblem();
    if (problem) throw new FacebookError(problem);
    const row = await prisma.facebookPageLink.findUnique({ where: { id: FACEBOOK_LINK_ID }, select: { userTokenEnc: true } });
    if (!row) throw new FacebookError("Facebook is not connected — Campaigns → Channels → Connect.");
    const token = unlockSecret(row.userTokenEnc, "shared");
    if (!token) throw new FacebookError("The saved Facebook access cannot be opened (AI_KEY_SECRET changed?) — connect again.");
    return token;
}

async function pageRows(): Promise<PageRow[]> {
    const { data = [] } = await graph<{ data?: PageRow[] }>("/me/accounts", {
        params: { fields: "id,name,category,access_token,tasks", limit: "100", access_token: await userToken() },
    });
    return data;
}

/** Every page the connected person manages — never their tokens. */
export async function listFacebookPages(): Promise<FacebookPage[]> {
    return (await pageRows()).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category ?? null,
        // CREATE_CONTENT is the page task posting needs.
        canPost: !p.tasks || p.tasks.includes("CREATE_CONTENT"),
    }));
}

/** The Instagram business account linked to a page, or null when it has none. */
async function linkedInstagram(pageId: string, pageToken: string): Promise<{ id: string; username: string | null } | null> {
    const r = await graph<{ instagram_business_account?: { id: string; username?: string } }>(`/${pageId}`, {
        params: { fields: "instagram_business_account{id,username}", access_token: pageToken },
    });
    const ig = r.instagram_business_account;
    return ig ? { id: ig.id, username: ig.username ?? null } : null;
}

/**
 * Pick the page posts go to: its own token is read here, server side, and
 * locked away; its linked Instagram account (if any) is noted with it.
 */
export async function pickFacebookPage(pageId: string): Promise<string | null> {
    const page = (await pageRows()).find((p) => p.id === pageId);
    if (!page?.access_token) return "That page is not managed by the connected Facebook account.";
    // An older Connect lacks the Instagram permissions — the page still posts, Instagram waits for a Reconnect.
    const ig = await linkedInstagram(page.id, page.access_token).catch(() => null);
    await prisma.facebookPageLink.update({
        where: { id: FACEBOOK_LINK_ID },
        data: {
            pageId: page.id,
            pageName: page.name,
            pageTokenEnc: lockSecret(page.access_token, "shared"),
            igUserId: ig?.id ?? null,
            igUsername: ig?.username ?? null,
            lastError: null,
        },
    });
    return null;
}

/** Connection as the Channels page shows it — never a token. */
export async function facebookStatus() {
    const row = await prisma.facebookPageLink.findUnique({
        where: { id: FACEBOOK_LINK_ID },
        select: { fbUserName: true, pageId: true, pageName: true, igUsername: true, igUserId: true, connectedByName: true, lastError: true, updatedAt: true },
    });
    const ready = !!row?.pageId && !facebookSetupProblem();
    return { setupProblem: facebookSetupProblem(), connected: !!row, ...row, ready, instagramReady: ready && !!row?.igUserId };
}

/** Is Facebook posting fully set up (connected and a page picked)? */
export async function facebookReady(): Promise<boolean> {
    if (facebookSetupProblem()) return false;
    const row = await prisma.facebookPageLink.findUnique({ where: { id: FACEBOOK_LINK_ID }, select: { pageId: true } });
    return !!row?.pageId;
}

/** The picked page, its opened token and its linked Instagram id — for every API post. */
export async function pageAccess(): Promise<{ pageId: string; token: string; igUserId: string | null }> {
    const problem = facebookSetupProblem();
    if (problem) throw new FacebookError(problem);
    const row = await prisma.facebookPageLink.findUnique({ where: { id: FACEBOOK_LINK_ID }, select: { pageId: true, pageTokenEnc: true, igUserId: true } });
    if (!row?.pageId || !row.pageTokenEnc) throw new FacebookError("Pick the shop's page on Campaigns → Channels first.");
    const token = unlockSecret(row.pageTokenEnc, "shared");
    if (!token) throw new FacebookError("The saved Facebook access cannot be opened (AI_KEY_SECRET changed?) — connect again.");
    return { pageId: row.pageId, token, igUserId: row.igUserId };
}

type PostForFacebook = { caption: string; link: string | null; mediaKey: string | null; mediaType: string | null };

/**
 * Put one post up on the page: the caption with its shop link, and the photo or
 * video if it has one (Facebook fetches it once from the signed R2 link).
 * Returns the post's link on Facebook. Throws FacebookError with a reason staff
 * can read; the reason is also kept on the link for the Channels page.
 */
export async function postToFacebook(p: PostForFacebook): Promise<string | null> {
    const block = facebookAutoBlock(p);
    if (block) throw new FacebookError(block);
    const { pageId, token } = await pageAccess();

    const shop = COMPANY_DETAILS.sites.shop;
    const text = postCaption(p, shop);
    let call: { path: string; params: Record<string, string> };
    if (p.mediaKey) {
        const url = mediaLink(p.mediaKey);
        if (!url) throw new FacebookError("File storage (R2) is not set up on this server, so Facebook cannot fetch the photo.");
        call = p.mediaType?.startsWith("video/")
            ? { path: `/${pageId}/videos`, params: { file_url: url, description: text } }
            : { path: `/${pageId}/photos`, params: { url, caption: text } };
    } else {
        // A text post: the link field gives the shop page its preview card.
        call = { path: `/${pageId}/feed`, params: { message: text, ...(p.link ? { link: `${shop}${p.link}` } : {}) } };
    }

    try {
        const made = await graph<{ id?: string; post_id?: string }>(call.path, { method: "POST", params: { ...call.params, access_token: token } });
        await noteFacebookError(null);
        const id = made.post_id ?? made.id;
        return id ? `https://www.facebook.com/${id}` : null;
    } catch (e) {
        if (e instanceof FacebookError) await noteFacebookError(e.message);
        throw e;
    }
}
