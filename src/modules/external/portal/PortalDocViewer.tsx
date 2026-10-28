import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import AppDocFit from "@/modules/external/shopApp/AppDocFit";
import AppDocActions from "@/modules/external/shopApp/AppDocActions";
import PortalDocPrint from "./PortalDocPrint";

/**
 * A bill or receipt opened in a browser (no app) — the app's bill screen
 * (back · title · Download · Share, the sheet fitted to the screen) plus Print,
 * centred at true A4 width on a desktop. Customer code only: no staff print bar.
 */
export default function PortalDocViewer({ title, fileBase, kindLabel, children }: {
    title: string;
    fileBase: string;
    /** "Bill" / "Receipt" — the Download / Share sheet's wording. */
    kindLabel: string;
    children: ReactNode;
}) {
    return (
        <div className="mx-auto w-full max-w-[826px]">
            <div className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background/95 px-1 py-1 backdrop-blur print:hidden">
                <Link href="/portal/bills" className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted" aria-label="Back to My Bills">
                    <ChevronLeft className="size-6" />
                </Link>
                <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
                <PortalDocPrint />
                <AppDocActions fileBase={fileBase} title={kindLabel} />
            </div>
            <AppDocFit>{children}</AppDocFit>
        </div>
    );
}
