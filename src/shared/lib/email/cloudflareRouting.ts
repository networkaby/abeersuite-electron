import "server-only";

/**
 * Cloudflare Email Routing — staff mail forwarding.
 *
 * Staff sign in as `name@networkservice.in`, a mailbox that does not exist: Cloudflare
 * forwards it to the person's own inbox (usually Gmail). This lets each person point
 * THEIR address at THEIR inbox from the profile, so "Forgot password" mail reaches them.
 *
 * Cloudflare is the only record — no column in our DB. The rule for an address says
 * where it goes; the destination says whether its owner has clicked Cloudflare's
 * "verify" mail. Nothing here to drift.
 *
 * Plain `fetch`, like sendEmail.ts. Needs CLOUDFLARE_API_TOKEN (Email Routing Rules:
 * Edit on the zone, Email Routing Addresses: Edit on the account), CLOUDFLARE_ACCOUNT_ID
 * and CLOUDFLARE_ZONE_ID. Office only — counters do not carry the token.
 */

export const STAFF_MAIL_DOMAIN = "networkservice.in";

export class ForwardingNotConfiguredError extends Error {
    constructor() {
        super("Mail forwarding is not set up on this server (Cloudflare keys missing).");
        this.name = "ForwardingNotConfiguredError";
    }
}

export function isForwardingConfigured(): boolean {
    return Boolean(
        process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_ZONE_ID,
    );
}

/** Only an address on our own domain has a Cloudflare rule to change. */
export function isStaffMailAddress(email: string): boolean {
    return email.toLowerCase().endsWith(`@${STAFF_MAIL_DOMAIN}`);
}

type CfEnvelope<T> = {
    success: boolean;
    errors?: { code: number; message: string }[];
    result: T;
    result_info?: { page: number; total_pages: number };
};

async function cf<T>(path: string, init?: RequestInit): Promise<CfEnvelope<T>> {
    if (!isForwardingConfigured()) throw new ForwardingNotConfiguredError();
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            "Content-Type": "application/json",
        },
        cache: "no-store",
    });
    const body = await res.json().catch(() => null) as CfEnvelope<T> | null;
    if (!res.ok || !body?.success) {
        // Vendor detail goes to logs, never to the person.
        const detail = body?.errors?.map(e => `${e.code} ${e.message}`).join("; ") ?? String(res.status);
        throw new Error(`Cloudflare ${init?.method ?? "GET"} ${path} failed: ${detail}`);
    }
    return body;
}

/** Every page of a Cloudflare list — rules grow with staff, 50 is the page cap. */
async function cfList<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; ; page++) {
        const body = await cf<T[]>(`${path}?per_page=50&page=${page}`);
        out.push(...body.result);
        if (!body.result_info || page >= body.result_info.total_pages) return out;
    }
}

type Destination = { id: string; email: string; verified: string | null };
type Rule = {
    id: string;
    name?: string;
    enabled: boolean;
    matchers: { type: string; field?: string; value?: string }[];
    actions: { type: string; value?: string[] }[];
};

const rulesPath = () => `/zones/${process.env.CLOUDFLARE_ZONE_ID}/email/routing/rules`;
const addressesPath = () => `/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/email/routing/addresses`;

async function ruleFor(address: string): Promise<Rule | undefined> {
    const rules = await cfList<Rule>(rulesPath());
    const a = address.toLowerCase();
    return rules.find(r => r.matchers.some(m => m.type === "literal" && m.field === "to" && m.value?.toLowerCase() === a));
}

async function destination(email: string): Promise<Destination | undefined> {
    const all = await cfList<Destination>(addressesPath());
    const e = email.toLowerCase();
    return all.find(d => d.email.toLowerCase() === e);
}

export type ForwardingStatus = {
    /** Where the address forwards now, or null when it has no forwarding rule. */
    forwardTo: string | null;
    /** false until the owner clicks Cloudflare's verify mail — nothing arrives before. */
    verified: boolean;
    enabled: boolean;
};

export async function getForwarding(address: string): Promise<ForwardingStatus> {
    const rule = await ruleFor(address);
    const forwardTo = rule?.actions.find(a => a.type === "forward")?.value?.[0] ?? null;
    if (!rule || !forwardTo) return { forwardTo: null, verified: false, enabled: false };
    const dest = await destination(forwardTo);
    return { forwardTo, verified: Boolean(dest?.verified), enabled: rule.enabled };
}

/**
 * Point `address` at `forwardTo`. Adding a new destination makes Cloudflare send it a
 * verify mail; mail flows once that link is clicked. The rule is written straight
 * away either way, so the person does not have to come back and save twice.
 */
export async function setForwarding(address: string, forwardTo: string): Promise<ForwardingStatus> {
    let dest = await destination(forwardTo);
    if (!dest) {
        dest = (await cf<Destination>(addressesPath(), {
            method: "POST",
            body: JSON.stringify({ email: forwardTo }),
        })).result;
    }

    const body = JSON.stringify({
        name: `Staff forward: ${address}`,
        enabled: true,
        matchers: [{ type: "literal", field: "to", value: address }],
        actions: [{ type: "forward", value: [forwardTo] }],
    });
    const rule = await ruleFor(address);
    if (rule) await cf(`${rulesPath()}/${rule.id}`, { method: "PUT", body });
    else await cf(rulesPath(), { method: "POST", body });

    return { forwardTo, verified: Boolean(dest.verified), enabled: true };
}
