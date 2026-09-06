// Offline parity checks for the ESC/POS builders — no printer, no socket.
// `getBuffer()` never opens the TCP interface, so a builder can run end to end
// as long as the raster paths (logo / UPI QR / MRP strike) are off.
//
// Run: pnpm test:bridge   (node --test hardware-bridge/thermal.test.js)
//
// The rules asserted here are the ones the paper slip must share with the
// thermal preview (src/shared/components/print/ThermalReceiptPreview.tsx).

const test   = require("node:test");
const assert = require("node:assert/strict");
const { buildPosBuffer, buildVoucherBuffer, ...rest } = require("./thermal.js");

const text = (buf) => buf.toString("latin1");
const DIVIDER = "-".repeat(20);

const baseTemplate = {
    kind: "POS",
    headerLine1: "Network Service",
    headerLine2: "TAX INVOICE",
    addressBlock: "Kalaparishad Market, Main Road\nBongaigaon, Assam, 783384",
    gstinLine: "GSTIN: 18AXEPJ4673R1ZO",
    phoneLine: "Ph: +91 88769 96996",
    emailLine: "hello@networkservice.in",
    websiteLine: "",
    logoUrl: "",
    showLogo: false,
    showHeaderText: true,
    showAddress: true,
    showBranchAddress: false,
    showGstin: true,
    showPhone: true,
    showTaxSummary: true,
    showMrp: false,
    showSignature: false,
    showBarcode: false,
    showBank: false,
    showPartyBalance: false,
    signatureLabel: "Authorised Signatory",
    termsText: "",
    footerLine: "",
    disclaimerLine: "",
    paperWidthMm: 80,
};

const posPayload = (tpl = {}) => ({
    invoiceNumber: "POS-940787-26",
    date: "2026-09-06",
    customerName: "Anupam Das",
    customerGstin: null,
    template: { ...baseTemplate, ...tpl },
    lines: [{ name: "Adapater ASUS 19v 33w", qty: 1, unitPrice: 1000, amount: 1000, mrp: 1499, barcode: 1106 }],
    subtotal: 1000, discountPct: 0, discountAmount: 0, tax: 139.62, total: 915,
    grossAtTag: 1106,
    discounts: [{ label: "Counter discount", amount: 106 }, { label: "Coupon", amount: 4.75 }],
    charges: [{ label: "Round-off", amount: -0.25 }],
    savings: { amount: 584, pct: 39 },
    hsnSummary: [{ cgst: 69.81, sgst: 69.81 }],
    receipts: [{ label: "Cash", amount: 915 }],
});

test("dead builders are gone", () => {
    assert.equal(rest.buildReceiptBuffer, undefined);
    assert.equal(rest.buildPaymentBuffer, undefined);
});

test("POS: brand prints from headerLine1 only; blank brand prints nothing", async () => {
    const withBrand = text(await buildPosBuffer(posPayload()));
    assert.ok(withBrand.includes("Network Service"));
    assert.ok(!withBrand.includes("My Company"));
    const noBrand = text(await buildPosBuffer(posPayload({ headerLine1: "" })));
    assert.ok(!noBrand.includes("My Company"));
    assert.ok(!noBrand.includes("Network Service"));
});

test("POS: title sits below the first divider (preview order)", async () => {
    const out = text(await buildPosBuffer(posPayload()));
    const firstDivider = out.indexOf(DIVIDER);
    const title = out.indexOf("TAX INVOICE");
    const address = out.indexOf("Kalaparishad");
    assert.ok(firstDivider > 0 && title > firstDivider, "title must follow the divider");
    assert.ok(address < firstDivider, "address stays above the divider");
});

test("POS: blank footer prints no fallback text; set footer prints", async () => {
    const blank = text(await buildPosBuffer(posPayload()));
    assert.ok(!blank.includes("Thank you"));
    const set = text(await buildPosBuffer(posPayload({ footerLine: "Visit again!" })));
    assert.ok(set.includes("Visit again!"));
});

test("POS: tender rows print from `receipts`; Total is title-case; incl. GST shown", async () => {
    const out = text(await buildPosBuffer(posPayload()));
    assert.ok(out.includes("Cash"));
    assert.ok(out.includes("915.00"));
    assert.ok(out.includes("Total"));
    assert.ok(!out.includes("TOTAL"));
    assert.ok(out.includes("incl. GST"));
    assert.ok(out.includes("You saved"));
});

test("POS: signature only when the template says so", async () => {
    const off = text(await buildPosBuffer(posPayload()));
    assert.ok(!off.includes("Authorised Signatory"));
    const on = text(await buildPosBuffer(posPayload({ showSignature: true })));
    assert.ok(on.includes("Authorised Signatory"));
});

test("POS: header toggles are read from the (already thermal-resolved) flags", async () => {
    const out = text(await buildPosBuffer(posPayload({ showHeaderText: false, showAddress: false, showGstin: false })));
    assert.ok(!out.includes("Network Service"));
    assert.ok(!out.includes("Kalaparishad"));
    assert.ok(!out.includes("GSTIN: 18AX"));
    assert.ok(out.includes("TAX INVOICE"));
});

const moneyPayload = (kind, tpl = {}) => ({
    kind,
    title: "Receipt",
    template: { ...baseTemplate, kind, headerLine2: kind === "RECEIPT" ? "RECEIPT" : "PAYMENT VOUCHER", ...tpl },
    sample: {
        reference: "RV-26-27-0042",
        date: "06 Sept 2026, 05:30",
        partyName: "Anupam Das",
        partyPhone: "9476711556",
        lines: [{ description: "Cash", quantity: 1, amount: 500 }, { description: "UPI", quantity: 1, amount: 415 }],
        subtotal: null, taxAmount: null, total: 915,
        notes: "Against POS-940787-26",
        balanceBefore: "Rs. 1,000.00 Dr",
        balanceAfter: "Rs. 85.00 Dr",
    },
});

test("RECEIPT via print/voucher: money middle mirrors the preview", async () => {
    const out = text(await buildVoucherBuffer(moneyPayload("RECEIPT")));
    assert.ok(out.includes("Received from:"));
    assert.ok(out.includes("RECEIVED"));
    assert.ok(out.includes("By: Cash"));
    assert.ok(out.includes("UPI"));
    assert.ok(out.includes("Towards: Against POS-940787-26"));
    assert.ok(out.includes("Rupees"));
    assert.ok(!out.includes("Received with thanks"));
    assert.ok(!out.includes("Authorised Signatory"), "signature obeys the toggle on money slips too");
    // date printed verbatim, as the preview does
    assert.ok(out.includes("06 Sept 2026, 05:30"));
});

test("PAYMENT via print/voucher uses the paid wording", async () => {
    const out = text(await buildVoucherBuffer(moneyPayload("PAYMENT")));
    assert.ok(out.includes("Paid to:"));
    assert.ok(out.includes("PAID"));
});

test("party balance strip only when showPartyBalance is on", async () => {
    const off = text(await buildVoucherBuffer(moneyPayload("RECEIPT")));
    assert.ok(!off.includes("Balance before"));
    const on = text(await buildVoucherBuffer(moneyPayload("RECEIPT", { showPartyBalance: true })));
    assert.ok(on.includes("Balance before"));
    assert.ok(on.includes("Balance after"));
});

test("generic invoice via print/voucher: Customer/Supplier row, no narration, receipts + balance due", async () => {
    const payload = {
        kind: "PURCHASE",
        template: { ...baseTemplate, kind: "PURCHASE", headerLine2: "Purchase" },
        sample: {
            reference: "PUR-26-27-0007",
            date: "2026-09-06",
            partyName: "Acme Traders",
            partyPhone: null,
            lines: [{ description: "Widget", quantity: 2, amount: 200 }],
            subtotal: 200, taxAmount: 36, total: 236,
            notes: "internal narration",
            receipts: [{ label: "Bank", amount: 100 }],
            balanceDue: 136,
        },
    };
    const out = text(await buildVoucherBuffer(payload));
    assert.ok(out.includes("Supplier:"));
    assert.ok(!out.includes("internal narration"));
    assert.ok(out.includes("Bank"));
    assert.ok(out.includes("Balance due"));
    assert.ok(out.includes("136.00"));
});
