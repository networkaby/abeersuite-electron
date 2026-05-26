import { PrintLabelsPage } from "@/modules/inventory/components/PrintLabelsPage";
import "./print-labels.css";

export const metadata = { title: "Print barcode labels" };

export default function PrintLabelsRoute() {
    return (
        <div className="space-y-4">
            <div className="print-hide">
                <h1 className="text-xl font-semibold">Print barcode labels</h1>
                <p className="text-sm text-muted-foreground">
                    Add products, set the layout, then send the sheet to your printer. CODE128 symbology.
                </p>
            </div>
            <PrintLabelsPage />
        </div>
    );
}
