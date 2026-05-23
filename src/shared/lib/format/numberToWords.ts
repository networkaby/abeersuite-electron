/**
 * Indian-system rupee → words. Used by A4 invoice layouts to render the
 * "Rupees X Only" line under the grand total. Handles up to 99 crore which
 * is well above any realistic invoice value here.
 *
 * Examples:
 *   3178.92 → "Rupees Three Thousand One Hundred Seventy Eight and Ninety Two Paise Only"
 *   50000   → "Rupees Fifty Thousand Only"
 *   0       → "Zero Rupees Only"
 */

const ONES = [
    "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
    "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under100(n: number): string {
    if (n < 20) return ONES[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o === 0 ? TENS[t] : `${TENS[t]} ${ONES[o]}`;
}

function under1000(n: number): string {
    if (n < 100) return under100(n);
    const h = Math.floor(n / 100);
    const r = n % 100;
    return r === 0 ? `${ONES[h]} Hundred` : `${ONES[h]} Hundred ${under100(r)}`;
}

function integerInWords(n: number): string {
    if (n === 0) return "Zero";
    // Indian grouping: crore (10⁷) → lakh (10⁵) → thousand (10³) → hundreds.
    const crore = Math.floor(n / 10_000_000); n %= 10_000_000;
    const lakh  = Math.floor(n / 100_000);    n %= 100_000;
    const thou  = Math.floor(n / 1_000);      n %= 1_000;
    const parts: string[] = [];
    if (crore) parts.push(`${under1000(crore)} Crore`);
    if (lakh)  parts.push(`${under1000(lakh)} Lakh`);
    if (thou)  parts.push(`${under1000(thou)} Thousand`);
    if (n)     parts.push(under1000(n));
    return parts.join(" ");
}

export function rupeesInWords(amount: number): string {
    const safe = Math.max(0, Math.round(amount * 100) / 100);
    const rupees = Math.floor(safe);
    const paise  = Math.round((safe - rupees) * 100);

    if (rupees === 0 && paise === 0) return "Zero Rupees Only";

    const rupeePart = rupees > 0 ? `Rupees ${integerInWords(rupees)}` : "";
    const paisePart = paise > 0 ? `${integerInWords(paise)} Paise` : "";

    if (rupeePart && paisePart) return `${rupeePart} and ${paisePart} Only`;
    if (rupeePart)              return `${rupeePart} Only`;
    return `${paisePart} Only`;
}
