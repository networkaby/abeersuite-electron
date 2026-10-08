import AppWishlist from "@/modules/external/shopApp/AppWishlist";
import { loadStorefrontProductsCached } from "@/shared/lib/shop/storefrontProducts";

/** Saved products — the list lives on the phone; the page brings the catalogue. */
export default async function CustomerAppWishlistPage() {
    return <AppWishlist products={await loadStorefrontProductsCached()} />;
}
