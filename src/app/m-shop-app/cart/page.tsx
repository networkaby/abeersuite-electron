import AppCart from "@/modules/external/shopApp/AppCart";
import { loadStorefrontProductsCached } from "@/shared/lib/shop/storefrontProducts";

/** The cart lives on the phone; the page brings the catalogue to price it. */
export default async function CustomerAppCartPage() {
    return <AppCart products={await loadStorefrontProductsCached()} />;
}
