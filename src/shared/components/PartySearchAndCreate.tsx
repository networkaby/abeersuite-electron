"use client";

/**
 * Shared "search a party or create one" surface used by POS and the
 * QuickTicket dialog. Owns:
 *  - debounced /api/person?lookup= search with arrow-key / enter navigation
 *  - a hit dropdown with a "New customer: {q}" CTA
 *  - the create dialog (Person + optional Company with state / PIN / GSTIN,
 *    smart focus, address mirroring, Indian + intl phone / email / PIN validation)
 *
 * Both POS and the new-ticket dialog consume it via `onPicked`; the caller
 * decides what to do next (fetch a customer snapshot, advance a wizard step…).
 *
 * Validators (phoneError, emailError, pinError, isPhoneLike) and the picked-
 * party shape are exported for callers that want to reuse them inline.
 */

import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
} from "react";
import axios from "axios";
import { toast } from "sonner";
import { Building2, ChevronDown, Search, User, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { usePartySearch, type PartyHit } from "@/shared/hooks/usePartySearch";

export type PickedParty = {
    kind: "customer" | "company";
    id: number;
    name: string;
    phone: string | null;
    accountId: number | null;
    linkedCompanies?: { id: number; name: string; accountId: number | null }[];
};

export type PartySearchAndCreateHandle = {
    /** Focus the search input. */
    focus: () => void;
    /** Reset the input + close the dialog. */
    clear: () => void;
    /** Open the create dialog directly (used by standalone "New customer" buttons). */
    openNew: () => void;
};

export type PartySearchAndCreateProps = {
    onPicked: (party: PickedParty) => void;
    /** Show the input as readOnly (e.g. POS locks once a party is chosen). */
    locked?: boolean;
    /** Auto-focus the input on mount. */
    autoFocus?: boolean;
    /** Override the default placeholder. */
    placeholder?: string;
    /** Extra render slot inside the hit dropdown's footer (rarely used). */
    footerSlot?: ReactNode;
    /** Optional className for the outer wrapper. */
    className?: string;
    /** Notified when the internal create dialog opens / closes. */
    onDialogOpenChange?: (open: boolean) => void;
    /**
     * The party group this picker represents — drives BOTH the default search
     * filter AND where the auto-created ledger lands. Pass `null` for an
     * "all parties" picker that creates under Sundry Debtors (legacy default).
     *
     *   POS / Sale / CN  → "Sundry Debtors"   (customers)
     *   Purchase / DN     → "Sundry Creditors" (suppliers)
     */
    partyGroup?: "Sundry Debtors" | "Sundry Creditors" | null;
    /**
     * Render a small "Include Sundry <other> too" checkbox under the search
     * input so the user can temporarily widen the search across the aisle.
     * Useful in Sale (a long-time customer may also be a supplier) and
     * Purchase (vice versa). Defaults to false — POS / CN / DN stay strict.
     */
    allowIncludeOther?: boolean;
    /**
     * Hide the optional Company section in the inline create dialog when only
     * a Person row makes sense. Defaults to true.
     */
    allowCompanyCreate?: boolean;
    /**
     * When true, opening the create dialog pre-fills the Company Name field
     * (instead of Person Name) and focuses it. Useful for purchase contexts
     * where suppliers are almost always companies.
     */
    defaultToCompany?: boolean;
};

// ── Validators ──────────────────────────────────────────────────────────────

const RE_INDIAN_PHONE = /^[6-9]\d{9}$/;
const RE_INTL_PHONE = /^\+\d{1,3}[\s-]?\d{6,14}$/;
export function phoneError(raw: string): string | null {
    const v = raw.trim().replace(/\s+/g, " ");
    if (!v) return null;
    if (RE_INDIAN_PHONE.test(v.replace(/\s|-/g, ""))) return null;
    if (RE_INTL_PHONE.test(v)) return null;
    return "10-digit Indian (6/7/8/9 first) or +CC…";
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function emailError(raw: string): string | null {
    const v = raw.trim();
    if (!v) return null;
    if (RE_EMAIL.test(v)) return null;
    return "Looks invalid";
}

const RE_PIN = /^[1-9]\d{5}$/;
export function pinError(raw: string): string | null {
    const v = raw.trim();
    if (!v) return null;
    if (RE_PIN.test(v)) return null;
    return "6 digits";
}

export function isPhoneLike(q: string): boolean {
    const trimmed = q.trim();
    if (trimmed.length < 4) return false;
    const digits = trimmed.replace(/\D/g, "").length;
    const letters = trimmed.replace(/[^a-zA-Z]/g, "").length;
    return digits >= 4 && letters === 0;
}

function FieldError({ msg }: { msg: string | null }) {
    if (!msg) return null;
    return <p className="text-[11px] text-destructive">{msg}</p>;
}

// ── Component ───────────────────────────────────────────────────────────────

const EMPTY_NEW_PARTY = {
    name: "", phone: "", email: "", address: "",
    companyName: "", companyPhone: "", companyEmail: "", companyAddress: "",
    companyState: "", companyPinCode: "", companyGstin: "",
};

export const PartySearchAndCreate = forwardRef<
    PartySearchAndCreateHandle,
    PartySearchAndCreateProps
>(function PartySearchAndCreate(
    {
        onPicked, locked = false, autoFocus = false, placeholder, footerSlot, className,
        onDialogOpenChange, partyGroup = null, allowIncludeOther = false, allowCompanyCreate = true,
        defaultToCompany = false,
    },
    ref,
) {
    const [query, setQuery] = useState("");
    const [highlightedHit, setHighlightedHit] = useState(0);
    const [includeOther, setIncludeOther] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [browseHits, setBrowseHits] = useState<PartyHit[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    // Effective group filter — strict to `partyGroup` unless the user opted to
    // widen the search via the "Include Sundry <other> too" checkbox.
    const effectiveGroup = partyGroup && !includeOther ? partyGroup : undefined;
    const { hits, loading } = usePartySearch(query, { enabled: !locked, group: effectiveGroup });
    // Auto-create lands in the picker's `partyGroup` (or default Sundry Debtors).
    const createUnderGroup = partyGroup ?? undefined;
    const otherGroup: "Sundry Debtors" | "Sundry Creditors" | null =
        partyGroup === "Sundry Debtors" ? "Sundry Creditors"
        : partyGroup === "Sundry Creditors" ? "Sundry Debtors"
        : null;

    // Browse-on-focus: fetch the full group list whenever the input is active
    // and empty (initial focus, or after backspace/delete clears the field).
    useEffect(() => {
        if (!isFocused || query.trim() || locked || !partyGroup) {
            setBrowseHits([]);
            return;
        }
        let cancelled = false;
        axios
            .get<PartyHit[]>(`/api/person?lookup=&group=${encodeURIComponent(partyGroup)}`)
            .then((r) => { if (!cancelled) setBrowseHits(r.data); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [isFocused, query, locked, partyGroup]);

    // activeHits: use browse list when focused+empty, search results otherwise
    const activeHits = isFocused && !query.trim() ? browseHits : hits;

    // Reset highlight when active hits change
    useEffect(() => { setHighlightedHit(0); }, [activeHits]);

    // ── Create dialog state ─────────────────────────────────────────────────
    const [openDialog, setOpenDialog] = useState(false);
    useEffect(() => { onDialogOpenChange?.(openDialog); }, [openDialog, onDialogOpenChange]);
    const [openedAsPhoneQuery, setOpenedAsPhoneQuery] = useState(false);
    const [newParty, setNewParty] = useState(EMPTY_NEW_PARTY);
    const [companyAddressTouched, setCompanyAddressTouched] = useState(false);
    const [creating, setCreating] = useState(false);
    // Surface server-side errors (e.g. "phone already used") inline so the user
    // can fix the offending field without scanning toasts that may have already
    // disappeared. `field` highlights the input that triggered the error.
    const [serverError, setServerError] = useState<{ message: string; field?: string } | null>(null);

    const nameRef = useRef<HTMLInputElement>(null);
    const phoneRef = useRef<HTMLInputElement>(null);
    const addressRef = useRef<HTMLTextAreaElement>(null);
    const companyNameRef = useRef<HTMLInputElement>(null);
    const companyPhoneRef = useRef<HTMLInputElement>(null);
    const companyAddressRef = useRef<HTMLTextAreaElement>(null);

    // Latest openNewParty reference (closure over current `query`). Read via ref
    // from the imperative handle so consumers' "New customer" buttons always see
    // the up-to-date query.
    const openNewPartyRef = useRef<() => void>(() => { });
    useImperativeHandle(ref, () => ({
        focus: () => inputRef.current?.focus(),
        clear: () => {
            setQuery("");
            setOpenDialog(false);
        },
        openNew: () => openNewPartyRef.current(),
    }), []);

    // Smart focus on dialog open + reset any stale banner from a prior attempt.
    useEffect(() => {
        if (!openDialog) return;
        setServerError(null);
        const t = setTimeout(() => {
            if (defaultToCompany && !openedAsPhoneQuery)
                companyNameRef.current?.focus();
            else
                (openedAsPhoneQuery ? nameRef.current : phoneRef.current)?.focus();
        }, 50);
        return () => clearTimeout(t);
    }, [openDialog, openedAsPhoneQuery, defaultToCompany]);

    // Clear the banner the moment the user touches any field — they're
    // fixing the input, the error is no longer current.
    useEffect(() => {
        if (!serverError) return;
        setServerError(null);
    // intentionally NOT depending on serverError to avoid a clear-loop;
    // any newParty mutation clears the banner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newParty]);

    // Mirror person address → company address until user edits it
    useEffect(() => {
        if (companyAddressTouched) return;
        if (!newParty.companyName.trim()) return;
        if (newParty.companyAddress === newParty.address) return;
        setNewParty((s) => ({ ...s, companyAddress: s.address }));
    }, [newParty.address, newParty.companyName, newParty.companyAddress, companyAddressTouched]);

    const showCompanySection = newParty.companyName.trim().length > 0;
    // A person needs name + at least one contact (phone or email). A company
    // can be created without contact info. The rule mirrors the "person without
    // a phone or email is unreachable" policy enforced UI-side.
    const wantsPerson = newParty.name.trim().length > 0;
    const wantsCompany = newParty.companyName.trim().length > 0;
    const personHasContact = !!(newParty.phone.trim() || newParty.email.trim());
    const personValid = !wantsPerson || personHasContact;
    const canSubmitCreate = (wantsPerson || wantsCompany) && personValid;

    // ── Pick handlers ───────────────────────────────────────────────────────

    const pickHit = (hit: PartyHit) => {
        if (hit.accountId == null) {
            toast.error(`${hit.name} has no ledger account yet`);
            return;
        }
        setQuery(hit.name);
        onPicked({
            kind: hit.type,
            id: hit.id,
            name: hit.name,
            phone: hit.phone,
            accountId: hit.accountId,
            linkedCompanies: hit.linkedCompanies,
        });
    };

    const openNewParty = async () => { await doOpenNewParty(); };
    // Keep ref in sync each render so the imperative handle's closure isn't stale.
    openNewPartyRef.current = () => { void doOpenNewParty(); };

    async function doOpenNewParty() {
        const q = query.trim();
        // Defensive re-check before opening: an exact match may exist
        if (q.length >= 2) {
            try {
                const groupSuffix = effectiveGroup ? `&group=${encodeURIComponent(effectiveGroup)}` : "";
                const { data } = await axios.get<PartyHit[]>(
                    `/api/person?lookup=${encodeURIComponent(q)}${groupSuffix}`,
                );
                if (data.length > 0) {
                    pickHit(data[0]);
                    return;
                }
            } catch { /* fall through */ }
        }
        const phoneLike = isPhoneLike(q);
        setOpenedAsPhoneQuery(phoneLike);
        const toCompany = defaultToCompany && !phoneLike;
        setNewParty({
            ...EMPTY_NEW_PARTY,
            companyName: toCompany ? q : "",
            name:        toCompany ? "" : (phoneLike ? "" : q),
            phone:       phoneLike ? q : "",
        });
        setCompanyAddressTouched(false);
        setOpenDialog(true);
    };

    const onSearchKeyDown = async (e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            if (activeHits.length === 0) return;
            e.preventDefault();
            setHighlightedHit((i) => Math.min(i + 1, activeHits.length - 1));
        } else if (e.key === "ArrowUp") {
            if (activeHits.length === 0) return;
            e.preventDefault();
            setHighlightedHit((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            if (query.trim().length < 2) return;
            e.preventDefault();
            if (activeHits.length > 0) {
                const hit = activeHits[highlightedHit] ?? activeHits[0];
                if (hit) pickHit(hit);
                return;
            }
            // Defensive re-check — debounce may not have fired
            try {
                const groupSuffix = effectiveGroup ? `&group=${encodeURIComponent(effectiveGroup)}` : "";
                const { data } = await axios.get<PartyHit[]>(
                    `/api/person?lookup=${encodeURIComponent(query)}${groupSuffix}`,
                );
                if (data.length > 0) {
                    pickHit(data[0]);
                    return;
                }
            } catch { /* fall through */ }
            openNewParty();
        } else if (e.key === "Escape") {
            setQuery("");
        }
    };

    const submitCreate = async () => {
        setServerError(null);                       // clear any prior banner
        const hasPerson = newParty.name.trim().length > 0;
        const hasCompany = newParty.companyName.trim().length > 0;
        if (!hasPerson && !hasCompany) {
            toast.error("Need at least a name or a company");
            nameRef.current?.focus();
            return;
        }
        // A person row is unreachable without a contact channel — UI gate
        // mirrors the customer-care policy: "no phone, no email → don't book".
        if (hasPerson && !(newParty.phone.trim() || newParty.email.trim())) {
            toast.error("Add a phone or email for the person");
            phoneRef.current?.focus();
            return;
        }
        const checks: Array<[string | null, string, () => void]> = [
            [phoneError(newParty.phone), "Phone", () => phoneRef.current?.focus()],
            [emailError(newParty.email), "Email", () => { /* tab-skipped */ }],
            [phoneError(newParty.companyPhone), "Company phone", () => companyPhoneRef.current?.focus()],
            [emailError(newParty.companyEmail), "Company email", () => { /* tab-skipped */ }],
            [pinError(newParty.companyPinCode), "PIN code", () => { /* no ref */ }],
        ];
        for (const [err, label, focus] of checks) {
            if (err) { toast.error(`${label}: ${err}`); focus(); return; }
        }
        setCreating(true);
        try {
            let personId: number | null = null;
            let personName = "";
            let personPhone: string | null = null;
            let personAccountId: number | null = null;
            if (hasPerson) {
                const personRes = await axios.post<{
                    id: number;
                    name: string;
                    phone?: string | null;
                    account?: { id: number } | null;
                }>("/api/person", {
                    name: newParty.name.trim(),
                    phones: newParty.phone.trim() ? [newParty.phone.trim()] : [],
                    emails: newParty.email.trim() ? [newParty.email.trim()] : [],
                    address: newParty.address.trim(),
                    ...(createUnderGroup ? { accountGroup: createUnderGroup } : {}),
                });
                personId = personRes.data.id;
                personName = personRes.data.name;
                personPhone = personRes.data.phone ?? (newParty.phone.trim() || null);
                personAccountId = personRes.data.account?.id ?? null;
            }

            let companyId: number | null = null;
            let companyName = "";
            let companyAccountId: number | null = null;
            if (hasCompany) {
                const companyRes = await axios.post<{
                    id: number;
                    name: string;
                    account?: { id: number } | null;
                }>("/api/companies", {
                    name: newParty.companyName.trim(),
                    phones: newParty.companyPhone.trim() ? [newParty.companyPhone.trim()] : [],
                    emails: newParty.companyEmail.trim() ? [newParty.companyEmail.trim()] : [],
                    address: [
                        newParty.companyAddress.trim(),
                        [newParty.companyState.trim(), newParty.companyPinCode.trim()]
                            .filter(Boolean).join(" - "),
                    ].filter(Boolean).join("\n"),
                    taxId: newParty.companyGstin.trim(),
                    ...(createUnderGroup ? { accountGroup: createUnderGroup } : {}),
                });
                companyId = companyRes.data.id;
                companyName = companyRes.data.name;
                companyAccountId = companyRes.data.account?.id ?? null;
            }

            // Link person to company if both were created
            if (personId && companyId) {
                try {
                    await axios.post(`/api/companies/${companyId}/links`, { personId });
                } catch { /* non-fatal; both rows still exist */ }
            }

            // Pick: company takes precedence when both created (the bill goes to company)
            const linkedCompanies =
                hasCompany && companyId && hasPerson
                    ? [{ id: companyId, name: companyName, accountId: companyAccountId }]
                    : undefined;

            if (hasCompany && companyId) {
                toast.success(
                    hasPerson
                        ? `Added · ${personName} @ ${companyName} — billing to company`
                        : `Added · ${companyName}`,
                );
                setQuery(companyName);
                onPicked({
                    kind: "company",
                    id: companyId,
                    name: companyName,
                    phone: newParty.companyPhone.trim() || null,
                    accountId: companyAccountId,
                });
            } else if (personId) {
                toast.success(`Added · ${personName}`);
                setQuery(personName);
                onPicked({
                    kind: "customer",
                    id: personId,
                    name: personName,
                    phone: personPhone,
                    accountId: personAccountId,
                    linkedCompanies,
                });
            } else {
                toast.error("Created, but no ledger account was returned — try again");
                return;
            }
            setOpenDialog(false);
        } catch (e: unknown) {
            // Server-side errors carry { error, field? } — e.g. 409 with
            // field: "phone" when the value is already used. Surface inline
            // so the user can fix the offending input, and still toast so a
            // closed dialog is noticed.
            let message: string | undefined;
            let field: string | undefined;
            if (axios.isAxiosError(e)) {
                const payload = e.response?.data as { error?: string; field?: string } | undefined;
                message = payload?.error;
                field = payload?.field;
            }
            const finalMessage = message ?? "Could not create";
            setServerError({ message: finalMessage, field });
            toast.error(finalMessage);
            // Move focus to the offending input when we know which one
            if (field === "phone") phoneRef.current?.focus();
            else if (field === "companyPhone") companyPhoneRef.current?.focus();
            else if (field === "companyName") companyNameRef.current?.focus();
        } finally {
            setCreating(false);
        }
    };

    const onAddressKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSubmitCreate) void submitCreate();
        }
    };

    const onAnyEnterToSubmit = (e: ReactKeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSubmitCreate) void submitCreate();
        }
    };

    const showDropdown = !locked && (activeHits.length > 0 || query.trim().length >= 2);

    return (
        <div className={`relative ${className ?? ""}`}>
            {/* Inner relative container so the magnifying-glass icon is centered
                ON THE INPUT only — not on the whole wrapper, which also holds
                the "Include … too" checkbox below and would push the icon
                down to the midpoint between input and checkbox. */}
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    placeholder={placeholder ?? "Search person or company by name / phone / email · ↵ to pick · ↵ on no-result to create"}
                    className={`pl-9 ${locked ? "bg-muted/50 cursor-default" : ""}`}
                    readOnly={locked}
                    autoFocus={autoFocus}
                    title={locked ? "Locked — clear to search again" : undefined}
                />
            </div>
            {allowIncludeOther && otherGroup && !locked && (
                <label className="mt-1 flex items-center gap-1.5 pl-1 text-[11px] text-muted-foreground select-none cursor-pointer">
                    <input
                        type="checkbox"
                        checked={includeOther}
                        onChange={(e) => setIncludeOther(e.target.checked)}
                        className="h-3 w-3 accent-primary cursor-pointer"
                    />
                    Include {otherGroup} too
                </label>
            )}
            {showDropdown && (
                <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                    {activeHits.map((c, i) => (
                        <li key={`${c.type}-${c.id}`}>
                            <button
                                type="button"
                                onClick={() => pickHit(c)}
                                onMouseEnter={() => setHighlightedHit(i)}
                                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${i === highlightedHit ? "bg-muted" : "hover:bg-muted"}`}
                            >
                                {c.type === "company"
                                    ? <Building2 size={14} className="shrink-0 text-muted-foreground" />
                                    : <User size={14} className="shrink-0 text-muted-foreground" />}
                                <span className="flex-1 truncate">{c.name}</span>
                                <Badge variant="secondary" className="text-[10px]">
                                    {c.type === "company" ? "Company" : "Person"}
                                </Badge>
                                <span className="w-32 truncate text-right text-xs text-muted-foreground">{c.phone ?? ""}</span>
                            </button>
                        </li>
                    ))}
                    {query.trim().length >= 2 && (
                        <li className="border-t border-border">
                            <button
                                type="button"
                                onClick={openNewParty}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-muted"
                            >
                                <UserPlus size={14} />
                                New customer{activeHits.length === 0 ? `: "${query.trim()}"` : ""}
                                <span className="ml-auto text-[10px] text-muted-foreground">
                                    {loading ? "searching…" : "↵"}
                                </span>
                            </button>
                        </li>
                    )}
                    {footerSlot}
                </ul>
            )}

            {/* ── Create dialog ─────────────────────────────────────────── */}
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
                <DialogContent className={showCompanySection ? "sm:max-w-2xl" : "sm:max-w-md"}>
                    <DialogHeader>
                        <DialogTitle>New customer · ↵ to save</DialogTitle>
                    </DialogHeader>

                    {serverError && (
                        <div
                            role="alert"
                            className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                        >
                            {serverError.message}
                        </div>
                    )}

                    <div className={`grid gap-4 ${showCompanySection ? "sm:grid-cols-2" : ""}`}>
                        {/* Person section */}
                        <div className="space-y-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Person {newParty.name.trim() === "" && newParty.companyName.trim() !== "" && <span className="ml-1 text-[10px] normal-case">· skipped</span>}
                            </div>

                            {openedAsPhoneQuery && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label>Phone <span className="text-[10px] text-muted-foreground">— phone or email required</span></Label>
                                        <Input
                                            ref={phoneRef}
                                            value={newParty.phone}
                                            onChange={(e) => setNewParty((s) => ({ ...s, phone: e.target.value }))}
                                            onKeyDown={onAnyEnterToSubmit}
                                            placeholder="10-digit"
                                            inputMode="tel"
                                            aria-invalid={!!phoneError(newParty.phone)}
                                        />
                                        <FieldError msg={phoneError(newParty.phone)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Email <span className="text-[10px] text-muted-foreground">— click to add, Tab skips</span></Label>
                                        <Input
                                            value={newParty.email}
                                            onChange={(e) => setNewParty((s) => ({ ...s, email: e.target.value }))}
                                            onKeyDown={onAnyEnterToSubmit}
                                            placeholder="optional"
                                            inputMode="email"
                                            tabIndex={-1}
                                            aria-invalid={!!emailError(newParty.email)}
                                        />
                                        <FieldError msg={emailError(newParty.email)} />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <Label>Name {showCompanySection ? <span className="text-[10px] text-muted-foreground">— blank for company-only</span> : "*"}</Label>
                                <Input
                                    ref={nameRef}
                                    value={newParty.name}
                                    onChange={(e) => setNewParty((s) => ({ ...s, name: e.target.value }))}
                                    onKeyDown={onAnyEnterToSubmit}
                                    placeholder="Customer name"
                                />
                            </div>

                            {!openedAsPhoneQuery && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label>Phone <span className="text-[10px] text-muted-foreground">— phone or email required</span></Label>
                                        <Input
                                            ref={phoneRef}
                                            value={newParty.phone}
                                            onChange={(e) => setNewParty((s) => ({ ...s, phone: e.target.value }))}
                                            onKeyDown={onAnyEnterToSubmit}
                                            placeholder="10-digit"
                                            inputMode="tel"
                                            aria-invalid={!!phoneError(newParty.phone)}
                                        />
                                        <FieldError msg={phoneError(newParty.phone)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Email <span className="text-[10px] text-muted-foreground">— click to add, Tab skips</span></Label>
                                        <Input
                                            value={newParty.email}
                                            onChange={(e) => setNewParty((s) => ({ ...s, email: e.target.value }))}
                                            onKeyDown={onAnyEnterToSubmit}
                                            placeholder="optional"
                                            inputMode="email"
                                            tabIndex={-1}
                                            aria-invalid={!!emailError(newParty.email)}
                                        />
                                        <FieldError msg={emailError(newParty.email)} />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <Label>Address</Label>
                                <Textarea
                                    ref={addressRef}
                                    value={newParty.address}
                                    onChange={(e) => setNewParty((s) => ({ ...s, address: e.target.value }))}
                                    onKeyDown={onAddressKeyDown}
                                    placeholder="optional · ↵ to save · Tab → company"
                                    rows={2}
                                />
                            </div>

                            {allowCompanyCreate && (
                                <div className="space-y-1.5 pt-1">
                                    <Label className="flex items-center gap-1.5 text-muted-foreground">
                                        <ChevronDown size={12} className={showCompanySection ? "rotate-180" : ""} />
                                        Company (optional)
                                    </Label>
                                    <Input
                                        ref={companyNameRef}
                                        value={newParty.companyName}
                                        onChange={(e) => setNewParty((s) => ({ ...s, companyName: e.target.value }))}
                                        onKeyDown={onAnyEnterToSubmit}
                                        placeholder="Company name (leave empty to bill the person)"
                                    />
                                </div>
                            )}
                        </div>

                        {allowCompanyCreate && showCompanySection && (
                            <div className="space-y-3 sm:border-l sm:border-border sm:pl-4">
                                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Company · billing here
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label>Company phone</Label>
                                        <Input
                                            ref={companyPhoneRef}
                                            value={newParty.companyPhone}
                                            onChange={(e) => setNewParty((s) => ({ ...s, companyPhone: e.target.value }))}
                                            onKeyDown={onAnyEnterToSubmit}
                                            placeholder="own number — no duplicates"
                                            inputMode="tel"
                                            aria-invalid={!!phoneError(newParty.companyPhone)}
                                        />
                                        <FieldError msg={phoneError(newParty.companyPhone)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Company email</Label>
                                        <Input
                                            value={newParty.companyEmail}
                                            onChange={(e) => setNewParty((s) => ({ ...s, companyEmail: e.target.value }))}
                                            onKeyDown={onAnyEnterToSubmit}
                                            placeholder="optional"
                                            inputMode="email"
                                            tabIndex={-1}
                                            aria-invalid={!!emailError(newParty.companyEmail)}
                                        />
                                        <FieldError msg={emailError(newParty.companyEmail)} />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Company address</Label>
                                    <Textarea
                                        ref={companyAddressRef}
                                        value={newParty.companyAddress}
                                        onChange={(e) => {
                                            setCompanyAddressTouched(true);
                                            setNewParty((s) => ({ ...s, companyAddress: e.target.value }));
                                        }}
                                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (canSubmitCreate) void submitCreate(); } }}
                                        placeholder={`autofilled from person address${companyAddressTouched ? " (edited)" : ""}`}
                                        rows={2}
                                    />
                                </div>
                                <div className="grid grid-cols-[1fr_140px] gap-3">
                                    <div className="space-y-1.5">
                                        <Label>State</Label>
                                        <Input
                                            value={newParty.companyState}
                                            onChange={(e) => setNewParty((s) => ({ ...s, companyState: e.target.value }))}
                                            onKeyDown={onAnyEnterToSubmit}
                                            placeholder="e.g. Assam"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>PIN code</Label>
                                        <Input
                                            value={newParty.companyPinCode}
                                            onChange={(e) => setNewParty((s) => ({ ...s, companyPinCode: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                                            onKeyDown={onAnyEnterToSubmit}
                                            placeholder="6 digits"
                                            inputMode="numeric"
                                            aria-invalid={!!pinError(newParty.companyPinCode)}
                                        />
                                        <FieldError msg={pinError(newParty.companyPinCode)} />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Company GSTIN</Label>
                                    <Input
                                        value={newParty.companyGstin}
                                        onChange={(e) => setNewParty((s) => ({ ...s, companyGstin: e.target.value.toUpperCase() }))}
                                        onKeyDown={onAnyEnterToSubmit}
                                        placeholder="optional · 15 chars"
                                        className="font-mono"
                                    />
                                </div>
                                <div className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                                    The bill goes to the company&apos;s ledger. The person stays as a contact.
                                </div>
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setOpenDialog(false)} disabled={creating}>
                            Cancel
                        </Button>
                        <Button onClick={submitCreate} disabled={creating || !canSubmitCreate}>
                            <UserPlus size={16} /> {creating
                                ? "Creating…"
                                : newParty.name.trim() && showCompanySection ? "Create person + company"
                                    : showCompanySection ? "Create company"
                                        : "Create Person"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
});
