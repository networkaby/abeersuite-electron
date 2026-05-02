import CategoriesManager from "@/modules/ecommerce/components/CategoriesManager";

export default function EcommerceCategoriesPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
                <p className="text-muted-foreground text-sm">Counts from active products.</p>
            </div>
            <CategoriesManager />
        </div>
    );
}
