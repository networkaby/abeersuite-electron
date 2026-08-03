// One spec table covering all six kinds of ledger particulars (bank, loan,
// credit card, BNPL, wallet, payment gateway). Each kind already ships its own
// type/EMPTY/parse/hasData/FIELD_LABELS/isGroupName in its own file; this
// module just lines them up in a uniform row so the create and edit dialogs can
// render and submit them in a loop instead of repeating six near-identical
// blocks of JSX and six near-identical payload lines each.
//
// Adding a seventh kind = add its lib file, then one row here.

import {
    type BankFields, EMPTY_BANK, hasBankData, parseBank, BANK_FIELD_LABELS,
    isBankGroupName, isOdGroupName,
} from "./bankParticulars";
import {
    type LoanFields, EMPTY_LOAN, hasLoanData, parseLoan, LOAN_FIELD_LABELS, isLoanGroupName,
} from "./loanParticulars";
import {
    type CreditCardFields, EMPTY_CREDIT_CARD, hasCreditCardData, parseCreditCard,
    CREDIT_CARD_FIELD_LABELS, isCreditCardGroupName,
} from "./creditCardParticulars";
import {
    type BnplFields, EMPTY_BNPL, hasBnplData, parseBnpl, BNPL_FIELD_LABELS, isBnplGroupName,
} from "./bnplParticulars";
import {
    type WalletFields, EMPTY_WALLET, hasWalletData, parseWallet, WALLET_FIELD_LABELS, isWalletGroupName,
} from "./walletParticulars";
import {
    type GatewayFields, EMPTY_GATEWAY, hasGatewayData, parseGateway, GATEWAY_FIELD_LABELS, isGatewayGroupName,
} from "./gatewayParticulars";

/** Every particulars kind is a flat bag of strings, so one shape fits all. */
export type ParticularsValue = Record<string, string>;

export interface ParticularsField {
    key: string;
    label: string;
    placeholder: string;
}

export interface ParticularsSpec {
    /** Key on the ledger row and in the API payload. */
    payloadKey: "bankJson" | "loanJson" | "creditCardJson" | "bnplJson" | "walletJson" | "gatewayJson";
    title: string;
    /** Muted note after the title. */
    hint: string;
    empty: ParticularsValue;
    parse: (raw: unknown) => ParticularsValue;
    hasData: (value: ParticularsValue) => boolean;
    /** Whether this block applies to a ledger sitting under `groupName`. */
    matches: (groupName?: string | null) => boolean;
    fields: ParticularsField[];
    /** Narrower gate for `advancedFields` and the tier select — Bank OD A/c
     *  only. Absent = those controls show whenever `matches` does. */
    advancedWhen?: (groupName?: string | null) => boolean;
    advancedFields?: ParticularsField[];
    /** Value the tier select reads as when stored blank. Absent = the kind has
     *  no Usable Fund tier at all (a loan is a borrowing, not a fund source). */
    fundTierDefault?: "INSTANT" | "OTHER";
}

export const PARTICULARS_SPECS: ParticularsSpec[] = [
    {
        payloadKey: "bankJson",
        title: "Bank Details",
        hint: "printed on the deposit slip",
        empty: EMPTY_BANK,
        parse: parseBank,
        hasData: (v) => hasBankData(v as BankFields),
        matches: isBankGroupName,
        fields: BANK_FIELD_LABELS,
        // A plain Bank Accounts ledger has no facility limit or tier to set —
        // only a Bank OD A/c does.
        advancedWhen: isOdGroupName,
        advancedFields: [{ key: "limit", label: "OD Limit (₹)", placeholder: "500000" }],
        fundTierDefault: "INSTANT",
    },
    {
        payloadKey: "loanJson",
        title: "Loan Details",
        hint: "optional, informational",
        empty: EMPTY_LOAN,
        parse: parseLoan,
        hasData: (v) => hasLoanData(v as LoanFields),
        matches: isLoanGroupName,
        fields: LOAN_FIELD_LABELS,
    },
    {
        payloadKey: "creditCardJson",
        title: "Credit Card Details",
        hint: "optional, informational",
        empty: EMPTY_CREDIT_CARD,
        parse: parseCreditCard,
        hasData: (v) => hasCreditCardData(v as CreditCardFields),
        matches: isCreditCardGroupName,
        fields: CREDIT_CARD_FIELD_LABELS,
        fundTierDefault: "OTHER",
    },
    {
        payloadKey: "bnplJson",
        title: "BNPL Details",
        hint: "optional, informational",
        empty: EMPTY_BNPL,
        parse: parseBnpl,
        hasData: (v) => hasBnplData(v as BnplFields),
        matches: isBnplGroupName,
        fields: BNPL_FIELD_LABELS,
        fundTierDefault: "OTHER",
    },
    {
        payloadKey: "walletJson",
        title: "Wallet Details",
        hint: "optional, informational",
        empty: EMPTY_WALLET,
        parse: parseWallet,
        hasData: (v) => hasWalletData(v as WalletFields),
        matches: isWalletGroupName,
        fields: WALLET_FIELD_LABELS,
        fundTierDefault: "OTHER",
    },
    {
        payloadKey: "gatewayJson",
        title: "Payment Gateway Details",
        hint: "optional, informational",
        empty: EMPTY_GATEWAY,
        parse: parseGateway,
        hasData: (v) => hasGatewayData(v as GatewayFields),
        matches: isGatewayGroupName,
        fields: GATEWAY_FIELD_LABELS,
        fundTierDefault: "OTHER",
    },
];

/** Editor state: every kind held at once, keyed by payload key. The group
 *  decides which ones are shown and which ones are actually submitted. */
export type ParticularsState = Record<string, ParticularsValue>;

/** Blank state for a new ledger. */
export function emptyParticulars(): ParticularsState {
    return Object.fromEntries(PARTICULARS_SPECS.map((s) => [s.payloadKey, { ...s.empty }]));
}

/** Read the stored json columns off a ledger row into editor state. */
export function parseParticulars(source: Record<string, unknown> | null | undefined): ParticularsState {
    return Object.fromEntries(
        PARTICULARS_SPECS.map((s) => [s.payloadKey, s.parse(source?.[s.payloadKey])]),
    );
}

/** Build the six json keys for the API. A kind that doesn't match the chosen
 *  group — or that was left blank — is sent as null, so moving a ledger out of
 *  (say) the Bank group clears its bank particulars. */
export function particularsPayload(
    groupName: string | undefined | null,
    state: ParticularsState,
): Record<string, ParticularsValue | null> {
    return Object.fromEntries(PARTICULARS_SPECS.map((s) => {
        const value = state[s.payloadKey] ?? s.empty;
        const keep = s.matches(groupName) && s.hasData(value);
        return [s.payloadKey, keep ? value : null];
    }));
}
