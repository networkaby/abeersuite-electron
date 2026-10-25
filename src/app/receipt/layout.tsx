import CurrencySymbolInit from "@/shared/components/CurrencySymbolInit";
import { loadCurrencySymbol } from "@/shared/lib/format/currencySymbol.server";

// Every printable slip formats money in the browser too (ReceiptButtons, the
// client print components), so the Org Defaults symbol is handed down here.
export default async function ReceiptLayout({ children }: { children: React.ReactNode }) {
    const symbol = await loadCurrencySymbol();
    return (
        <>
            <CurrencySymbolInit symbol={symbol} />
            {children}
        </>
    );
}
