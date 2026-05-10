/** Format integer paise as ₹ string with two decimals (e.g. 19900 → ₹199.00). */
export function formatRupeesFromPaise(paise: number): string {
    const rupees = paise / 100;
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(rupees);
}

/** Format rupees (already a float) as ₹ string with no decimals (e.g. 1234 → ₹1,234). */
export function formatRupees(rupees: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(rupees);
}
