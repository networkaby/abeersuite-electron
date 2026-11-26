// ── A4 chrome: letterhead, footer, bank block, sign-off ─────────────────────
// The template-driven blocks every A4 document shares around its middle.
// Assembled by InvoiceBody in A4InvoicePreview.tsx.

import type { VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import { BarcodeSvg } from "@/modules/inventory/components/BarcodeSvg";
import { QrSvg } from "@/shared/components/print/QrSvg";
import { gstinDerivedStateCode } from "@/shared/lib/gst/computeGstSplit";
import { stateNameForCode } from "@/shared/lib/gst/indianStates";
import { DEPOSIT_SLIP_KINDS, type A4ChromeProps } from "@/shared/components/print/a4/a4Shared";
import { warrantyItemsLabel } from "@/shared/lib/warranty/warrantyTerms";

/** Template-driven letterhead (logo · brand · address · GSTIN · phone) + banner. */
export function A4Header({ template, sample }: A4ChromeProps) {
    // headerLine1 is always filled by mergeTemplateWithOrg (Organisation brand
    // fallback) — one brand source, no second fallback here.
    const brand = template.headerLine1;
    const addrLines = template.addressBlock.split("\n").map((l) => l.trim()).filter(Boolean);
    // The configured lines often already carry their own label ("GSTIN: 18AX…",
    // "Ph: +91 …") because that's how they read in the settings field. Strip it
    // so the rendered row doesn't print "GSTIN: GSTIN: 18AX…".
    const unlabel = (v: string, label: RegExp) => v.replace(label, "").trim();
    const gstin = unlabel(template.gstinLine, /^\s*GSTIN(\s*\/\s*UIN)?\s*[:\-]?\s*/i);
    const phone = unlabel(template.phoneLine, /^\s*(Ph|Phone|Tel|Mob(ile)?)\s*[:\-]?\s*/i);
    // A tax invoice must state the supplier's state and code. The GSTIN encodes
    // it in its first two characters, so no extra configuration is needed.
    const sellerStateCode = gstinDerivedStateCode(gstin);
    const sellerState = stateNameForCode(sellerStateCode);

    return (
        <>
            {/* 1 — Letterhead */}
            <div className="header row between" style={{ alignItems: "flex-start" }}>
                <div className="col">
                    <div className="row" style={{ alignItems: "center", gap: 12 }}>
                        {template.showLogo && template.logoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={template.logoUrl} alt="logo" style={{ maxHeight: 56, maxWidth: 160 }} />
                        )}
                        <div>
                            {template.showHeaderText && <div className="brand">{brand}</div>}
                            {template.showAddress && addrLines.length > 0 && (
                                <div className="small muted" style={{ marginTop: 3 }}>
                                    {addrLines.map((l, i) => <div key={i}>{l}</div>)}
                                </div>
                            )}
                            {template.showBranchAddress && sample.branchAddress && (
                                <div className="small muted" style={{ marginTop: 3 }}>
                                    <span className="bold">Branch: </span>
                                    {sample.branchAddress.split("\n").filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="col right">
                    {template.showGstin && gstin && (
                        <div className="small">
                            <span className="muted">GSTIN/UIN: </span>
                            <span className="bold">{gstin}</span>
                        </div>
                    )}
                    {template.showGstin && sellerState && (
                        <div className="small">
                            <span className="muted">State Name: </span>
                            <span>{sellerState}, Code : {sellerStateCode}</span>
                        </div>
                    )}
                    {template.showPhone && phone && (
                        <div className="small">
                            <span className="muted">Ph: </span>
                            <span>{phone}</span>
                        </div>
                    )}
                    {template.showPhone && template.emailLine && (
                        <div className="small">
                            <span className="muted">Email: </span>
                            <span>{template.emailLine}</span>
                        </div>
                    )}
                    {template.showPhone && template.websiteLine && (
                        <div className="small">
                            <span className="muted">Web: </span>
                            <span>{template.websiteLine}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* 2 — Title banner (document type — kept even when the brand-name
                 text is hidden). The deposit / handover slip drops the boxed
                 border and shows a plain centred heading instead. */}
            {template.headerLine2 && (
                <div className={`banner${DEPOSIT_SLIP_KINDS.has(template.kind) ? " banner-plain" : ""}`}>
                    {template.headerLine2}
                </div>
            )}
        </>
    );
}

/** Template-driven footer chrome (notes · terms · signature · footer line · barcode). */
export function A4Footer({ template, sample }: A4ChromeProps) {
    return (
        <div className="footer-block">
            {/* Warranty — the bill's items grouped by the warranty they were sold
                 with, by their row number in the goods table. Sale bills only;
                 nothing prints when no line carries a term. */}
            {template.showWarranty && sample.warranty && sample.warranty.length > 0 && (
                <div className="terms">
                    <span className="bold">Warranty:</span>
                    {sample.warranty.map((g) => (
                        <div key={g.items.join(",")}>
                            <span className="bold">{warrantyItemsLabel(g.items)}</span> — {g.label}.{g.condition ? ` ${g.condition}` : ""}
                        </div>
                    ))}
                </div>
            )}
            {/* 7 — Terms + signature + footer.
                 No narration here by design: the voucher narration is internal
                 bookkeeping text and never goes on a customer document (Tally
                 behaves the same way). The per-line item note is a different
                 field and DOES print, under its item in the goods table. The
                 money-receipt / journal / handover middles keep their own
                 narration lines — there the narration is the document's
                 content, not an incidental note. */}
            {template.termsText && (
                <div className="terms"><span className="bold">Terms &amp; Conditions:</span>{"\n"}{template.termsText}</div>
            )}

            {/* The bank block lives in <A4SignOff>, beside the signature, so
                the two sit on one row with their bottoms aligned. */}
        </div>
    );
}

/** Bank heading + scan-to-pay QR beside the labelled account lines. */
function BankBlock({ template }: { template: VoucherTemplateDefaults }) {
    return (
        <div>
            <span className="bold">Bank Details:</span>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 4 }}>
                {template.bankUpiQr && (
                    <div style={{ textAlign: "center", flexShrink: 0 }}>
                        <QrSvg value={template.bankUpiQr} size={84} />
                        <div style={{ fontSize: 8, letterSpacing: 1 }}>SCAN TO PAY</div>
                    </div>
                )}
                {template.bankDetails && (
                    <div style={{ whiteSpace: "pre-line" }}>{template.bankDetails}</div>
                )}
            </div>
        </div>
    );
}

/**
 * Sign-off strip — signature, footer line, disclaimer, barcode.
 *
 * Repeated on EVERY sheet, not just the last. Tally prints an Authorised
 * Signatory on each page of a multi-page invoice (the tax-analysis annexure
 * carries its own), because a loose sheet with no signature and no brand is not
 * a document anyone can act on. Kept separate from <A4Footer> for exactly that
 * reason: the terms + bank block is bulky boilerplate that belongs once, at the
 * end, while this strip belongs on all of them.
 */
export function A4SignOff({ template, sample, showBank }: A4ChromeProps & { showBank?: boolean }) {
    const bank = !!showBank && template.showBank
        && !!(template.bankDetails || template.bankUpiQr);
    return (
        <div className="signoff">
            {/* Bank block and signature share ONE row with their bottoms
                aligned — the account details and the authorising signature are
                the two things a reader looks for at the foot of a bill, so they
                should sit on a common baseline rather than stacked. The QR
                travels with the account lines: a bare scan code says nothing
                about who is being paid. */}
            {(bank || (template.kind !== "SHIFT_CLOSE" && template.showSignature)) && (
                <div className="signoff-row">
                    <div className="signoff-bank">{bank && <BankBlock template={template} />}</div>
                    {template.kind !== "SHIFT_CLOSE" && template.showSignature && (
                        <div className="sig-block">{template.signatureLabel}</div>
                    )}
                </div>
            )}

            {template.footerLine && (
                <div className="footer-line">{template.footerLine}</div>
            )}
            {template.disclaimerLine && (
                <div className="disclaimer">{template.disclaimerLine}</div>
            )}

            {/* Scannable voucher number — for pulling up the sale at return time.
                 Centred under the footer, sized well below full width so it
                 reads as a reference mark rather than a headline element. */}
            {template.showBarcode && sample.reference && (
                <div className="barcode-corner">
                    <BarcodeSvg value={sample.reference} height={40} fontSize={13} margin={4} className="barcode" />
                </div>
            )}
        </div>
    );
}
