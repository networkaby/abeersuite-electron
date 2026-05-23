import { ItemImportPanel } from "@/modules/settings/components/ItemImportPanel";

export const metadata = { title: "Item Import" };

export default function ItemImportPage() {
    return (
        <div className="space-y-6 p-6">
            <div>
                <h1 className="text-xl font-semibold">Item Import</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Upload a CSV of products, map your columns to product fields, preview, then commit. Existing
                    masters (units, brands, etc.) must already exist — rows referencing missing masters are flagged as
                    errors and skipped.
                </p>
            </div>
            <ItemImportPanel />
        </div>
    );
}
