import AppTopBar from "@/modules/external/shopApp/AppTopBar";
import AppCategoryGrid from "@/modules/external/shopApp/AppCategoryGrid";
import { loadStorefrontProductsCached, storefrontCategories } from "@/shared/lib/shop/storefrontProducts";

// Rendered on request, never at build time: the build must not read the catalogue
// (on a schema release the build DB lacks the new columns). The product list is
// still cached 5 minutes, so opening the app costs no extra database read.
export const dynamic = "force-dynamic";

/** Every category with something in it, biggest first. */
export default async function CustomerAppCategoriesPage() {
    const categories = storefrontCategories(await loadStorefrontProductsCached());
    return (
        <>
            <AppTopBar title="Categories" />
            <main className="py-4">
                {categories.length > 0 ? (
                    <AppCategoryGrid categories={categories} />
                ) : (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing in the shop yet.</p>
                )}
            </main>
        </>
    );
}
