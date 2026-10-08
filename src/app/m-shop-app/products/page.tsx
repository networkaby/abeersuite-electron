import AppProductList from "@/modules/external/shopApp/AppProductList";
import { loadStorefrontProductsCached } from "@/shared/lib/shop/storefrontProducts";

/** Search results and category lists — one screen, filtered on the phone. */
export default async function CustomerAppProductsPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; category?: string }>;
}) {
    const [{ q, category }, products] = await Promise.all([searchParams, loadStorefrontProductsCached()]);
    return <AppProductList products={products} initialQuery={q ?? ""} initialCategory={category ?? null} />;
}
