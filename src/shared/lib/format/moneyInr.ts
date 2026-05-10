/** Format integer paise as ₹ string (e.g. 19900 → ₹199.00). */
export function formatRupeesFromPaise(paise: number): string {
    const rupees = paise / 100;
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(rupees);
}
