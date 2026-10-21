import "server-only";
import { APICallError } from "ai";
import { AI_WEB_LIMITS } from "@/shared/lib/constants/ai";
import { runChain, type AiKeyConfig } from "@/shared/lib/ai/aiKeys";

/**
 * Web tools on Settings → AI Setup (Exa, Tavily, Firecrawl, Scrape.do): search
 * the web for a query, or read one page. Both run on the "web" use's chains, so
 * rest, gap and daily limits work as for the AI keys. A model without its own
 * search (aiKeys.callModel) searches through here; any AI job may call these.
 *
 * Failures are thrown as APICallError so runChain and the Test button read the
 * provider's status the same way they do for a model.
 */

export type WebPage = { title: string; url: string; text: string };

async function post(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal) {
    return send(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal }, body);
}

async function send(url: string, init: RequestInit, body: unknown = {}) {
    const res = await fetch(url, init);
    const text = await res.text();
    if (!res.ok) {
        // Scrape.do takes the token in the URL — never let it reach a log or the page.
        const safeUrl = url.split("?")[0];
        throw new APICallError({ message: `${res.status} ${res.statusText}`, url: safeUrl, requestBodyValues: body, statusCode: res.status, responseBody: text.slice(0, 1000) });
    }
    return text;
}

const json = (text: string) => JSON.parse(text) as Record<string, unknown>;
type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** One search on this key. */
export async function searchOn(key: AiKeyConfig, apiKey: string, query: string, signal: AbortSignal): Promise<WebPage[]> {
    const bearer = { Authorization: `Bearer ${apiKey}` };
    switch (key.provider) {
        case "exa": {
            const r = json(await post("https://api.exa.ai/search", { query, type: "auto", contents: { highlights: true } }, { "x-api-key": apiKey }, signal));
            return ((r.results as Row[]) ?? []).map((x) => ({ title: str(x.title), url: str(x.url), text: ((x.highlights as string[]) ?? []).join(" … ") }));
        }
        case "tavily": {
            const r = json(await post("https://api.tavily.com/search", { query }, bearer, signal));
            return ((r.results as Row[]) ?? []).map((x) => ({ title: str(x.title), url: str(x.url), text: str(x.content) }));
        }
        case "firecrawl": {
            const r = json(await post("https://api.firecrawl.dev/v2/search", { query }, bearer, signal));
            const data = r.data as Row[] | { web?: Row[] } | undefined;
            const rows = Array.isArray(data) ? data : (data?.web ?? []);
            return rows.map((x) => ({ title: str(x.title), url: str(x.url), text: str(x.description) || str(x.markdown) }));
        }
        default:
            throw new Error(`${key.provider} cannot search`);
    }
}

/** One page read on this key, as plain text / markdown. */
export async function readOn(key: AiKeyConfig, apiKey: string, url: string, signal: AbortSignal): Promise<WebPage> {
    const bearer = { Authorization: `Bearer ${apiKey}` };
    const cut = (text: string) => text.slice(0, AI_WEB_LIMITS.pageChars);
    switch (key.provider) {
        case "exa": {
            const r = json(await post("https://api.exa.ai/contents", { urls: [url], text: true }, { "x-api-key": apiKey }, signal));
            const x = ((r.results as Row[]) ?? [])[0] ?? {};
            return { title: str(x.title), url, text: cut(str(x.text)) };
        }
        case "tavily": {
            const r = json(await post("https://api.tavily.com/extract", { urls: [url] }, bearer, signal));
            const x = ((r.results as Row[]) ?? [])[0] ?? {};
            return { title: "", url, text: cut(str(x.raw_content)) };
        }
        case "firecrawl": {
            const r = json(await post("https://api.firecrawl.dev/v2/scrape", { url, formats: ["markdown"] }, bearer, signal));
            const x = (r.data as Row) ?? {};
            return { title: str((x.metadata as Row | undefined)?.title), url, text: cut(str(x.markdown)) };
        }
        case "scrapedo": {
            const q = new URLSearchParams({ token: apiKey, url, output: "markdown" });
            return { title: "", url, text: cut(await send(`https://api.scrape.do/?${q}`, { signal })) };
        }
        default:
            throw new Error(`${key.provider} cannot read pages`);
    }
}

/** Search the web on the "web" chain. Web tools are always allowed — they are not the paid AI. */
export async function webSearch(query: string): Promise<WebPage[]> {
    const { result } = await runChain({ use: "web", step: "search", premium: true }, (k, apiKey, signal) => searchOn(k, apiKey, query, signal));
    return result.filter((p) => p.url).slice(0, AI_WEB_LIMITS.results);
}

/** Read one page on the "web" chain. */
export async function readPage(url: string): Promise<WebPage> {
    return (await runChain({ use: "web", step: "read", premium: true }, (k, apiKey, signal) => readOn(k, apiKey, url, signal))).result;
}

/** Search results as a prompt block: each page's URL and what it says. */
export function pagesForPrompt(pages: WebPage[]): string {
    return [
        "Web pages read today (use only these; cite the URL a fact came from):",
        ...pages.map((p, i) => `[${i + 1}] ${p.title}\nURL: ${p.url}\n${p.text}`),
    ].join("\n\n");
}
