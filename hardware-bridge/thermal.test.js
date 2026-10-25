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

test("POS credit bill: balance due always; party balance only with showPartyBalance", async () => {
    const credit = {
        receipts: [{ label: "Cash", amount: 500 }],
        balanceDue: 415,
        balanceBefore: "Rs. 1,000.00 Dr",
        balanceAfter: "Rs. 1,415.00 Dr",
    };
    const off = text(await buildPosBuffer({ ...posPayload(), ...credit }));
    assert.ok(off.includes("Balance due"));
    assert.ok(off.includes("415.00"));
    assert.ok(!off.includes("Previous balance"));
    assert.ok(!off.includes("Closing balance"));
    const on = text(await buildPosBuffer({ ...posPayload({ showPartyBalance: true }), ...credit }));
    assert.ok(on.includes("Previous balance"));
    assert.ok(on.includes("Rs. 1,000.00 Dr"));
    assert.ok(on.includes("Closing balance"));
    assert.ok(on.includes("Rs. 1,415.00 Dr"));
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

test("POS: line note (serial) prints under the item unless showLineNote is off", async () => {
    const withNote = (tpl) => {
        const p = posPayload(tpl);
        p.lines = [{ ...p.lines[0], note: "SN 11142677" }];
        return p;
    };
    const on = text(await buildPosBuffer(withNote({ showLineNote: true })));
    assert.ok(on.includes("SN 11142677"));
    assert.ok(on.indexOf("SN 11142677") > on.indexOf("Adapater ASUS"), "note sits under the item");
    // A template from a server that predates the flag has no key — still prints.
    assert.ok(!("showLineNote" in baseTemplate));
    assert.ok(text(await buildPosBuffer(withNote({}))).includes("SN 11142677"));
    const off = text(await buildPosBuffer(withNote({ showLineNote: false })));
    assert.ok(!off.includes("SN 11142677"));
});

test("print/voucher: line note prints under the item unless showLineNote is off", async () => {
    const payload = (showLineNote) => ({
        kind: "POS",
        template: { ...baseTemplate, showLineNote },
        sample: {
            reference: "POS-940787-26",
            date: "2026-09-06",
            partyName: "Mezanur Rahman",
            lines: [{ description: "Fingerprint Scanner Mantra MFS110 L1", note: "11142677", quantity: 1, amount: 2900 }],
            subtotal: 2900, taxAmount: 442.37, total: 2900,
        },
    });
    const on = text(await buildVoucherBuffer(payload(true)));
    assert.ok(on.includes("11142677"));
    assert.ok(on.indexOf("11142677") > on.indexOf("Fingerprint"), "note sits under the item");
    assert.ok(!text(await buildVoucherBuffer(payload(false))).includes("11142677"));
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

test("SHIFT_CLOSE via print/voucher: mirrors ShiftCloseBody with reconciliation, cash flow, and tenders", async () => {
    // `body` is the real ShiftCloseBodyData the /receipt/shift/[id] page posts —
    // every money field a paise string. Keep it that way: a rupee-named payload
    // here printed a green test while the counter printed Rs. 0.00 everywhere.
    const payload = {
        kind: "SHIFT_CLOSE",
        title: "Shift #42 Closing Report",
        template: {
            ...baseTemplate,
            kind: "SHIFT_CLOSE",
            headerLine1: "AbeerSuite Retail",
            headerLine2: "Shift Closing & Cash Reconciliation",
        },
        sample: {
            reference: "Shift #42",
            date: "2026-09-14 18:30",
            partyName: "Rahul Sharma",
            partyPhone: null,
            lines: [],
        },
        body: {
            shiftId: 42,
            status: "CLOSED",
            openedAt: "2026-09-14T03:30:00.000Z",
            closedAt: "2026-09-14T13:00:00.000Z",
            durationStr: "9h 30m",
            cashierName: "Rahul Sharma",
            counterName: "POS Counter 1",
            tillAccountName: "Counter 1 Cash",
            branchName: "Main Branch",
            openingFloatPaise: "200000",
            tillMovementPaise: "1250000",
            dropsPaise: "1000000",
            expectedCashPaise: "450000",
            declaredCashPaise: "450000",
            variancePaise: "0",
            carryOverNextPaise: "200000",
            toVaultPaise: "250000",
            movementBreakdown: {
                cashSalesPaise:    "1300000",
                receiptsPaise:     "50000",
                expendituresPaise: "80000",
                refundsPaise:      "20000",
                otherPaise:        "0",
            },
            tenderBreakdown: [
                { label: "Cash",    amountPaise: "1300000" },
                { label: "UPI / QR", amountPaise: "850000" },
            ],
            collectionsBreakdown: {
                salesPaise:        "2150000",
                salesCount:        45,
                receiptsPaise:     "50000",
                receiptsCount:     2,
                refundsPaise:      "20000",
                refundsCount:      1,
                netCollectedPaise: "2180000",
            },
            closingContraVoucher: { reference: "CON-002" },
            varianceJournalEntry: { reference: "JV-0007" },
            notes: "End of shift handover completed.",
        },
    };
    const out = text(await buildVoucherBuffer(payload));
    assert.ok(out.includes("Shift #42 (CLOSED)"));
    assert.ok(out.includes("POS Counter 1"));
    assert.ok(out.includes("Rahul Sharma"));
    assert.ok(out.includes("9h 30m"));
    assert.ok(out.includes("CASH RECONCILIATION"));
    assert.ok(out.includes("Counter Opening Cash"));
    assert.ok(out.includes("2,000.00"), "opening float prints rupees, not paise or zero");
    assert.ok(out.includes("12,500.00"), "counter cash flow prints rupees");
    assert.ok(out.includes("Cash Sales"));
    assert.ok(out.includes("13,000.00"));
    assert.ok(out.includes("Dropped to Safe"));
    assert.ok(out.includes("10,000.00"));
    assert.ok(out.includes("Expected in Drawer"));
    assert.ok(out.includes("4,500.00"));
    assert.ok(out.includes("Physical Count (Declared)"));
    assert.ok(out.includes("Balanced"));
    assert.ok(out.includes("CLOSING DISTRIBUTION"));
    assert.ok(out.includes("Kept in Counter"));
    assert.ok(out.includes("Swept to Vault"));
    assert.ok(out.includes("2,500.00"));
    assert.ok(out.includes("PAYMENTS COLLECTED"));
    assert.ok(out.includes("UPI / QR"));
    assert.ok(out.includes("8,500.00"));
    assert.ok(out.includes("Total Collected"));
    assert.ok(out.includes("21,500.00"), "tender total prints rupees");
    assert.ok(out.includes("COLLECTIONS BY ACTIVITY"));
    assert.ok(out.includes("POS Sales (45)"));
    assert.ok(out.includes("21,800.00"));
    assert.ok(out.includes("LINKED VOUCHERS"));
    assert.ok(out.includes("CON-002"));
    assert.ok(out.includes("JV-0007"));
    assert.ok(out.includes("End of shift handover completed."));
    // The only legitimate zero is a balanced variance; anything else means the
    // paise fields were not read and the slip fell back to zero.
    assert.ok(
        !out.replace(/Rs\. 0\.00 \(Balanced\)/g, "").includes("Rs. 0.00"),
        "no money line falls back to zero",
    );
});

test("SHIFT_CLOSE signature obeys the template toggle", async () => {
    const makePayload = (showSignature) => ({
        kind: "SHIFT_CLOSE",
        template: {
            ...baseTemplate,
            kind: "SHIFT_CLOSE",
            signatureLabel: "Cashier Signature",
            showSignature,
        },
        sample: { reference: "Shift #42", date: "2026-09-14", lines: [] },
        body: { shiftId: 42, status: "CLOSED", openingFloatPaise: "100000", expectedCashPaise: "100000", tillMovementPaise: "0" },
    });

    const off = text(await buildVoucherBuffer(makePayload(false)));
    assert.ok(!off.includes("Cashier Signature"), "Cashier signature hidden when toggle is off");
    assert.ok(!off.includes("Manager Signature"), "Manager signature hidden when toggle is off");

    const on = text(await buildVoucherBuffer(makePayload(true)));
    assert.ok(on.includes("Cashier Signature"), "Cashier signature shown when toggle is on");
    assert.ok(on.includes("Manager Signature"), "Manager signature shown when toggle is on");
});

test("drawer kick: full five-byte ESC p on both pins", () => {
    assert.deepEqual(
        [...rest.DRAWER_KICK],
        [0x1b, 0x70, 0x00, 0x19, 0xfa, 0x1b, 0x70, 0x01, 0x19, 0xfa],
    );
});

test("drawer opens only when the PC has one AND the slip asks — kick first", async () => {
    const slip = await buildPosBuffer(posPayload());
    const both = rest.withDrawerKick({ cashDrawer: true }, { openDrawer: true }, slip);
    assert.deepEqual(both.subarray(0, rest.DRAWER_KICK.length), rest.DRAWER_KICK);
    assert.deepEqual(both.subarray(rest.DRAWER_KICK.length), slip);
    // A reprint (no openDrawer) or a PC without a drawer sends the slip untouched.
    assert.equal(rest.withDrawerKick({ cashDrawer: true },  {},                   slip), slip);
    assert.equal(rest.withDrawerKick({ cashDrawer: false }, { openDrawer: true }, slip), slip);
    assert.equal(rest.withDrawerKick({},                     { openDrawer: true }, slip), slip);
    // The slip itself never carries a kick on its own.
    assert.ok(!slip.includes(Buffer.from([0x1b, 0x70])));
});


test("rupee: ₹ prints as Rs. by default, as the drawn slot when the PC says so", async () => {
    assert.equal(rest.rupeeText("Total ₹499.00", false), "Total Rs. 499.00");
    assert.equal(rest.rupeeText("₹ 5 `x`", true), "` 5 'x'");
    const payload = { kind: "SHIFT_CLOSE", body: { id: 1, expectedCashPaise: 50000 }, template: baseTemplate };
    const plain = await buildVoucherBuffer(payload);
    assert.ok(!plain.includes(rest.RUPEE_DEFINE));
    const drawn = await buildVoucherBuffer(payload, { rupeeGlyph: true });
    // Loaded at the top — only the code-page select (ESC t n) comes before it.
    assert.equal(drawn.indexOf(rest.RUPEE_DEFINE), 3);
    assert.equal(rest.RUPEE_DEFINE.length, 6 + 36 + 3);
});
