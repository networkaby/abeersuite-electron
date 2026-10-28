"use client";

import { Printer } from "lucide-react";
import { APP_DOC_SHEET_ID } from "@/modules/external/shopApp/AppDocFit";

/** Paper shows the sheet alone at true A4 — the site chrome and the screen fit are dropped. */
const PRINT_CSS = `@media print {
    @page { size: A4; margin: 0; }
    body * { visibility: hidden; }
    #${APP_DOC_SHEET_ID}, #${APP_DOC_SHEET_ID} * { visibility: visible; }
    #${APP_DOC_SHEET_ID} { position: absolute; left: 0; top: 0; zoom: 1 !important; box-shadow: none !important; }
}`;

/** The browser's own print dialog, for the customer bill viewer (PortalDocViewer). */
export default function PortalDocPrint() {
    return (
        <>
            <style>{PRINT_CSS}</style>
            <button type="button" onClick={() => window.print()} className="flex size-11 items-center justify-center rounded-full hover:bg-muted active:bg-muted" aria-label="Print">
                <Printer className="size-5" />
            </button>
        </>
    );
}
