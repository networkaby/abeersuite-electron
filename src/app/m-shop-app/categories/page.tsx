import AppTopBar from "@/modules/external/shopApp/AppTopBar";
import AppCategoryGrid from "@/modules/external/shopApp/AppCategoryGrid";
import { loadStorefrontProducts, storefrontCategories } from "@/shared/lib/shop/storefrontProducts";

export const revalidate = 300;

/** Every category with something in it, biggest first. */
export default async function CustomerAppCategoriesPage() {
    const categories = storefrontCategories(await loadStorefrontProducts());
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
