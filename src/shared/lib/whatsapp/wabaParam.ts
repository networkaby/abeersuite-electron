/** `?waba=<id>` on a WhatsApp settings call: which WhatsApp account it is about.
 *  Digits only; anything else (or none) = the bills account. */
export function wabaParam(req: Request): string | null {
    const v = new URL(req.url).searchParams.get("waba")?.trim() ?? "";
    return /^\d{5,25}$/.test(v) ? v : null;
}
