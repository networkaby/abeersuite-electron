/**
 * What the sign-in screens say about the product.
 *
 * TWO screens show this, and they cannot share code:
 *   - The counter's boot shell, `resources/shell/login.html`. It is on screen
 *     before the Next server has forked, so it can import nothing — it carries
 *     its own hand-written copy of these lists in its CONFIG block.
 *   - The real page, `src/app/staff/login/page.tsx`, which imports this file.
 *
 * So this file is the source of truth for the wording, and the shell's CONFIG is
 * the one hand-copy. CHANGE ONE, CHANGE THE OTHER — the two screens sit on top of
 * each other during a cold start and any difference shows as a flicker of
 * different text.
 */

/** The line above the spotlight, in small caps. */
export const LOGIN_TAGLINE = "One shop, one system.";

/** One line under the tips. Empty hides it. */
export const LOGIN_SHOP_MESSAGE = "Network Service — service with a smile.";

/** Seconds each spotlight and tip stays on screen. */
export const LOGIN_ROTATE_SECONDS = 7;

/**
 * Shown one at a time beside the card. Every claim here is something the app
 * actually does — keep it that way.
 */
export const LOGIN_SPOTLIGHTS: ReadonlyArray<{ head: string; body: string }> = [
    { head: "Billing that does not stop",
      body: "A sale is saved on this counter first, so the till keeps working when the line drops." },
    { head: "Books that keep themselves",
      body: "Every bill posts its own vouchers. Day book, ledgers and balance sheet stay in step." },
    { head: "Repair and warranty",
      body: "Take a device in, follow it to the bench, and hand it back with its warranty on record." },
    { head: "Stock you can trust",
      body: "Purchase, goods receipt, transfers and physical stock, with a running stock summary." },
    { head: "Customers who come back",
      body: "Loyalty, coupons and offers at the counter, and a portal they can sign in to." },
    { head: "Many counters, no collisions",
      body: "Each till holds its own reserved number range, so two counters can never clash." },
];

/** The modules this shop runs, listed under the spotlight. */
export const LOGIN_MODULES: readonly string[] = [
    "POS", "Accountancy", "Inventory", "Contacts", "Repair & Warranty",
    "CRM", "Help Desk", "E-Commerce", "Retention", "Pricing Strategy",
    "Compliance", "Business Intelligence", "Administration",
];

/**
 * Rotated under the card. Every shortcut here is a real one — they come from the
 * key handlers in `src/modules/pos/hooks/usePosBilling.ts`. If a shortcut changes
 * there, change it here too, or the counter learns something that is not true.
 */
export const LOGIN_TIPS: readonly string[] = [
    "F2 takes you to the customer box from anywhere — even while you are typing.",
    "Press / to jump back to the scan box.",
    "F6 opens a fresh bill in a new tab. The bill you are on stays as it is.",
    "Pick a cart line with ↑ and ↓, then press + or − to change its quantity.",
    "In checkout, Ctrl and Enter puts the remaining amount on cash.",
    "Search a customer by mobile number, not only by name.",
    "Open your shift before billing — the till account and the branch come from the shift.",
    "A sale is saved on this counter first, so billing keeps working if the line drops.",
    "Product search runs on this PC, so it stays quick even on a slow connection.",
    "A half-finished bill is not kept if the app restarts. Finish it or clear it before you close.",
    "Ctrl and − or + resizes the whole app. This counter remembers the size you set.",
];

/** The greeting. Hours are 24-hour; each entry is "from this hour onwards". */
export const LOGIN_GREETINGS: ReadonlyArray<{ from: number; text: string }> = [
    { from: 0,  text: "Good morning" },
    { from: 12, text: "Good afternoon" },
    { from: 17, text: "Good evening" },
];

/** The greeting for an hour of the day — last entry whose `from` we have passed. */
export function loginGreeting(hour: number): string {
    let pick = LOGIN_GREETINGS[0].text;
    for (const g of LOGIN_GREETINGS) if (hour >= g.from) pick = g.text;
    return pick;
}
