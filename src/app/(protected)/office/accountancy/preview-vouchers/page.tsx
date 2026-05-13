// PREVIEW MIGRATION — temporary index for layout previews of the dialog-based
// vouchers (Payment, Receipt, Contra, Credit Note, Debit Note, Journal,
// Estimate). To be removed after the team meeting approves the new layouts.

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

const TILES: { kind: string; title: string; desc: string; href: string; family: "MoneyFlow" | "Journal" | "Trading" }[] = [
    { kind: "PAYMENT",     title: "Payment Voucher",   desc: "Cash / bank → parties or expenses.",                   href: "/office/accountancy/preview-vouchers/payment",     family: "MoneyFlow" },
    { kind: "RECEIPT",     title: "Receipt Voucher",   desc: "Parties or income → cash / bank.",                     href: "/office/accountancy/preview-vouchers/receipt",     family: "MoneyFlow" },
    { kind: "CONTRA",      title: "Contra Voucher",    desc: "Fund transfer between cash / bank accounts.",          href: "/office/accountancy/preview-vouchers/contra",      family: "MoneyFlow" },
    { kind: "CREDIT_NOTE", title: "Credit Note",       desc: "Lower a customer's outstanding (sales return / disc)", href: "/office/accountancy/preview-vouchers/credit-note", family: "MoneyFlow" },
    { kind: "DEBIT_NOTE",  title: "Debit Note",        desc: "Lower a supplier's outstanding (purchase return)",     href: "/office/accountancy/preview-vouchers/debit-note",  family: "MoneyFlow" },
    { kind: "JOURNAL",     title: "Journal Voucher",   desc: "Free-form Dr/Cr lines, optional inventory attachment.", href: "/office/accountancy/preview-vouchers/journal",    family: "Journal"   },
    { kind: "ESTIMATE",    title: "Estimate / Quote",  desc: "Customer quotation — no GL, no stock impact.",         href: "/office/accountancy/preview-vouchers/estimate",    family: "Trading"   },
];

export default function PreviewVouchersIndex() {
    return (
        <div className="max-w-5xl mx-auto py-8 px-6 space-y-8">
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-5 py-4">
                <Sparkles className="text-primary mt-0.5 shrink-0" size={18} />
                <div className="text-sm">
                    <p className="font-medium text-foreground">Layout previews — team review only</p>
                    <p className="text-muted-foreground mt-0.5">
                        Full-page Tally-finish layouts for the upcoming voucher redesign. Created vouchers
                        persist as real DB rows and can be cancelled / deleted from the corresponding list page.
                        The old dialogs are still mounted on the existing list-page <em>+ New</em> buttons until
                        the team approves the move.
                    </p>
                </div>
            </div>

            <div>
                <h1 className="text-2xl font-bold">Preview Vouchers</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Click any tile to open the full-page form. Each one mirrors the data the corresponding
                    dialog produces — same backend endpoints, same lifecycle, just a new UI shell.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {TILES.map((t) => (
                    <Link
                        key={t.kind}
                        href={t.href}
                        className="rounded-lg border border-border bg-card px-5 py-4 hover:border-primary hover:bg-primary/5 transition-colors group"
                    >
                        <div className="flex items-center justify-between">
                            <h2 className="font-semibold text-foreground">{t.title}</h2>
                            <ArrowRight size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-medium mt-2">{t.family} family</p>
                    </Link>
                ))}
            </div>
        </div>
    );
}
