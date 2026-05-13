// Indian-system number-to-words for currency display on vouchers.
// Output mirrors Tally's "Rupees Five Thousand and Fifty Paise Only" pattern.
//
// Coverage: integers up to 99,99,99,99,999 (99 thousand crore — well past any
// realistic invoice). Negative numbers prefix "Negative". Paise are rendered
// when the fractional part is > 0; the int part is always written.
//
// This is used by the Tally-finish voucher pages (MoneyFlow + Journal).

const ONES = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen",
    "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
    if (n < 20) return ONES[n];
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return ones === 0 ? TENS[tens] : `${TENS[tens]} ${ONES[ones]}`;
}

function threeDigits(n: number): string {
    if (n < 100) return twoDigits(n);
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    return rest === 0 ? `${ONES[hundreds]} Hundred` : `${ONES[hundreds]} Hundred ${twoDigits(rest)}`;
}

// Build the words for the integer part of an amount using Indian crore / lakh
// place values (lakh = 1,00,000; crore = 1,00,00,000).
function intToWordsIndian(n: number): string {
    if (n === 0) return "Zero";

    const parts: string[] = [];

    const crore = Math.floor(n / 10_000_000); n %= 10_000_000;
    const lakh  = Math.floor(n / 100_000);    n %= 100_000;
    const thou  = Math.floor(n / 1_000);      n %= 1_000;
    const hund  = n; // 0–999

    if (crore > 0) parts.push(`${threeDigits(crore)} Crore`);
    if (lakh  > 0) parts.push(`${twoDigits(lakh)} Lakh`);
    if (thou  > 0) parts.push(`${twoDigits(thou)} Thousand`);
    if (hund  > 0) parts.push(threeDigits(hund));

    return parts.join(" ");
}

/**
 * Indian-format rupees-in-words for currency display.
 *
 * @example
 *   numberToIndianWords(5_000)        // "Rupees Five Thousand Only"
 *   numberToIndianWords(1_23_456.75)  // "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Five Paise Only"
 *   numberToIndianWords(0)            // "Rupees Zero Only"
 */
export function numberToIndianWords(amount: number): string {
    if (!Number.isFinite(amount)) return "";

    const negative = amount < 0;
    const abs = Math.abs(amount);

    const rupees = Math.floor(abs);
    // Round paise to whole numbers — currency display only needs 2 decimals.
    const paise  = Math.round((abs - rupees) * 100);

    const rupeesWords = intToWordsIndian(rupees);
    const paiseWords  = paise > 0 ? ` and ${twoDigits(paise)} Paise` : "";

    return `${negative ? "Negative " : ""}Rupees ${rupeesWords}${paiseWords} Only`;
}
