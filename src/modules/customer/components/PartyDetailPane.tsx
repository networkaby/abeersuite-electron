"use client";

// The right-hand side of the Contacts screens (All / Person / Companies): one open
// party — person or company — with its header, tabs and every tab's body.
//
// The three pages each drew their own copy of this, and the copies had drifted:
// only one had the period filter, only the companies one linked a device's ticket,
// a company had no Tickets tab. Now there is one, and both kinds get the same
// features — the only differences left are the ones in the data (a person links to
// companies, a company lists its contacts).

import { useCallback, useEffect } from "react";
import { Building2, Loader2, Printer, RefreshCw, Smartphone, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GatedLink } from "@/shared/components/GatedLink";
import { ModuleTabs } from "@/shared/components/ModuleTabs";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { useSessionScroll, useSessionState } from "@/shared/hooks";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { PRIORITY_META } from "@/shared/lib/constants/badges";
import { badgeColor } from "@/shared/lib/format/entityColor";
import { formatDate } from "@/shared/lib/format/formatDate";
import { cn } from "@/shared/lib/format/utils";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { PartyOutstandingsPanel } from "@/modules/accountancy/components/PartyOutstandingsPanel";
import { LoyaltyPanel } from "@/modules/loyalty/components/LoyaltyPanel";
import { useActivePartyStore } from "@/store/activePartyStore";
import type { CustomerDevice, Ticket } from "@/modules/customer/lib/customerTypes";
import { usePartyDetail, usePartyTransactions, type PartyKind } from "@/modules/customer/hooks/usePartyProfile";
import CustomerEmptyState from "@/modules/customer/components/CustomerEmptyState";
import PersonProfileTab from "@/modules/customer/components/PersonProfileTab";
import CompanyProfileTab from "@/modules/customer/components/CompanyProfileTab";
import CustomerLinkPanel from "@/modules/customer/components/CustomerLinkPanel";
import CompanyLinkPanel from "@/modules/customer/components/CompanyLinkPanel";
import CustomerQualityTab from "@/modules/customer/components/CustomerQualityTab";
import PartyBankTab from "@/modules/customer/components/PartyBankTab";
import { PartyDetailHeader } from "@/modules/customer/components/PartyDetailHeader";
import { TransactionsTable } from "@/modules/customer/components/TransactionsTable";

export type PartyRef = { kind: PartyKind; id: number };

/** What /api/person/[id] and /api/companies/[id] both send. */
interface PartyDetailBase {
    id: number;
    accountId: number;
    creditLimit: string | null;
    accountGroupName: string | null;
    customerGroupId: number | null;
    openingBalance: string | null;
    openingBalanceType: "DEBIT" | "CREDIT" | null;
    openingBalanceDate: string | null;
    isActive: boolean;
    noDiscount: boolean;
    qualityLog: unknown;
    /** The party's own bank account (how we pay them) — see PartyBankTab. */
    bankJson: unknown;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    aliases: string[];
    createdAt: string;
    devices: CustomerDevice[];
}

export interface PersonDetail extends PartyDetailBase {
    companies: { id: number; company: { id: number; name: string; phone: string | null; accountId: number } }[];
    phones: { id: number; phone: string; label: string | null; isPrimary: boolean }[];
    emails: { id: number; email: string; label: string | null; isPrimary: boolean }[];
}

export interface CompanyDetail extends PartyDetailBase {
    companyReg: string | null;
    taxId: string | null;
    customers: { id: number; customer: { id: number; accountId: number; name: string; phone: string | null } }[];
    contactRows: {
        phones: { id: number; value: string; label: string | null; isPrimary: boolean }[];
        emails: { id: number; value: string; label: string | null; isPrimary: boolean }[];
    } | null;
}

type Tab = "transactions" | "outstanding" | "profile" | "bank" | "tickets" | "devices" | "links" | "loyalty" | "quality";

/** The tab strip, in order. "links" is the one tab whose words differ by kind. */
const TABS = ["transactions", "outstanding", "profile", "bank", "tickets", "devices", "links", "loyalty", "quality"] as const satisfies readonly Tab[];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface Props {
    party: PartyRef;
    /** sessionStorage prefix — tab, period and scroll come back after Back from a voucher. */
    stateKey: string;
    canEdit: boolean;
    canDelete: boolean;
    canManageUsers: boolean;
    canManageLoyalty: boolean;
    /** Open another party in this pane (a person converted to a company and back). */
    onOpen: (party: PartyRef) => void;
    /** The profile was saved — the list patches the row's name in place. */
    onRenamed: (party: PartyRef, name: string) => void;
    /** Deleted or deactivated — it leaves the list; close it. */
    onDeleted: () => void;
    /** Reactivated — its row changes. */
    onReactivated: () => void;
}

export function PartyDetailPane({
    party, stateKey, canEdit, canDelete, canManageUsers, canManageLoyalty,
    onOpen, onRenamed, onDeleted, onReactivated,
}: Props) {
    const { kind, id } = party;
    const partyKey = `${kind}:${id}`;
    // The open profile — a reply for a party the screen has already left is dropped.
    const person = usePartyDetail<PersonDetail>(kind === "person" ? "person" : null, kind === "person" ? id : null, "Failed to load customer");
    const company = usePartyDetail<CompanyDetail>(kind === "company" ? "company" : null, kind === "company" ? id : null, "Failed to load company");
    const detail: PersonDetail | CompanyDetail | null = kind === "person" ? person.detail : company.detail;
    const loading = kind === "person" ? person.loading : company.loading;
    const reloadDetail = kind === "person" ? person.reload : company.reload;

    // A newly opened party starts on its statement; a tab choice belongs to the party
    // it was made for.
    const [tabChoice, setTabChoice] = useSessionState<{ key: string | null; tab: Tab }>(`${stateKey}:tab`, { key: null, tab: "transactions" });
    const tab: Tab = tabChoice.key === partyKey ? tabChoice.tab : "transactions";
    const setTab = (next: Tab) => setTabChoice({ key: partyKey, tab: next });

    const [from, setFrom] = useSessionState(`${stateKey}:from`, toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useSessionState(`${stateKey}:to`, toIsoDate(new Date()));
    // The statement for the open party and period — read while its tab is on screen,
    // marked stale (and re-read on the way back in) while it is not.
    const {
        transactions, loading: txLoading, refreshing: txRefreshing, reload: reloadTransactions, markStale: markTxStale,
    } = usePartyTransactions(kind, id, { from, to }, tab === "transactions");

    const { ref: scrollRef, onScroll } = useSessionScroll(`${stateKey}:scroll:${partyKey}:${tab}`, tab === "transactions" ? !!transactions : !!detail);

    // Quick Actions read the open profile so a party-facing voucher opens with
    // this party in place. Cleared when the profile closes or the page unmounts.
    const setActiveParty = useActivePartyStore((s) => s.setParty);
    useEffect(() => {
        setActiveParty(detail ? {
            kind: kind === "person" ? "customer" : "company",
            id: detail.id,
            name: detail.name,
            phone: detail.phone,
            accountId: detail.accountId,
        } : null);
        return () => setActiveParty(null);
    }, [detail, kind, setActiveParty]);

    const refetch = useCallback(async () => {
        const fresh = await reloadDetail();
        if (fresh) onRenamed({ kind, id: fresh.id }, fresh.name);
    }, [reloadDetail, onRenamed, kind]);
    const handleSaved = useCallback(() => { void refetch(); }, [refetch]);
    const handleLinked = useCallback(() => { void reloadDetail(); }, [reloadDetail]);
    const handleReactivated = useCallback(() => { void refetch(); onReactivated(); }, [refetch, onReactivated]);

    if (loading) {
        return (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
                <Loader2 size={20} className="animate-spin" />
            </div>
        );
    }
    if (!detail) return null;

    const personDetail = kind === "person" ? (detail as PersonDetail) : null;
    const companyDetail = kind === "company" ? (detail as CompanyDetail) : null;

    const tickets: (Ticket & { device: CustomerDevice })[] = detail.devices
        .flatMap((device) => device.tickets.map((ticket) => ({ ...ticket, device })))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const linkCount = personDetail ? personDetail.companies.length : companyDetail!.customers.length;
    const linkChip = personDetail
        ? { key: "links", icon: <Building2 size={11} />, text: plural(linkCount, "company", "companies") }
        : { key: "links", icon: <User size={11} />, text: plural(linkCount, "contact") };

    return (
        <>
            <PartyDetailHeader
                name={detail.name}
                phone={detail.phone}
                address={detail.address}
                email={detail.email}
                extra={companyDetail?.companyReg ? <span className="text-xs text-muted-foreground">Reg: {companyDetail.companyReg}</span> : null}
                createdAt={detail.createdAt}
                socialHref={`/office/user/${detail.id}`}
                chips={[
                    linkChip,
                    { key: "devices", icon: <Smartphone size={11} />, text: plural(detail.devices.length, "device") },
                    { key: "tickets", text: plural(tickets.length, "ticket") },
                ]}
            />

            <ModuleTabs
                module="customers"
                tabs={TABS}
                labels={{ links: personDetail ? "Companies" : "Contacts" }}
                active={tab}
                onChange={setTab}
            />

            <div ref={scrollRef} onScroll={onScroll} className={cn("flex-1 overflow-y-auto", tab !== "transactions" && "p-6")}>
                {tab === "profile" && personDetail && (
                    <PersonProfileTab
                        detail={personDetail}
                        canEditCustomer={canEdit}
                        canManageUsers={canManageUsers}
                        canDeleteCustomer={canDelete}
                        onSaved={handleSaved}
                        onConverted={(companyId) => onOpen({ kind: "company", id: companyId })}
                        onDeleted={onDeleted}
                        onReactivated={handleReactivated}
                    />
                )}
                {tab === "profile" && companyDetail && (
                    <CompanyProfileTab
                        detail={companyDetail}
                        canEditCompany={canEdit}
                        canDeleteCompany={canDelete}
                        onSaved={handleSaved}
                        onConverted={(personId) => onOpen({ kind: "person", id: personId })}
                        onDeleted={onDeleted}
                        onReactivated={handleReactivated}
                    />
                )}

                {/* Bank — the party's own account, for paying them */}
                {tab === "bank" && (
                    <PartyBankTab
                        key={`bank-${partyKey}`}
                        party={{ kind, id: detail.id, name: detail.name }}
                        initialBank={detail.bankJson}
                        canEdit={canEdit}
                        onSaved={handleSaved}
                    />
                )}

                {tab === "tickets" && (
                    tickets.length === 0 ? (
                        <CustomerEmptyState icon={<span className="text-3xl">🎫</span>} message="No tickets for this party yet" />
                    ) : (
                        <Card>
                            <CardContent className="px-0 pt-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Ticket</TableHead>
                                            <TableHead>Device</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Priority</TableHead>
                                            <TableHead>Date</TableHead>
                                            <TableHead />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {tickets.map((ticket) => (
                                            <TableRow key={ticket.id}>
                                                <TableCell className="font-mono text-xs text-muted-foreground">#{ticket.id}</TableCell>
                                                <TableCell>
                                                    <span className="text-sm font-medium">{ticket.device.brand} {ticket.device.model}</span>
                                                    <span className="block text-xs text-muted-foreground">{ticket.device.type}</span>
                                                </TableCell>
                                                <TableCell><Badge {...badgeColor(ticket.ticketStatus.color)}>{ticket.ticketStatus.label}</Badge></TableCell>
                                                <TableCell><Badge className={PRIORITY_META[ticket.priority]?.color ?? ""}>{PRIORITY_META[ticket.priority]?.label ?? ticket.priority}</Badge></TableCell>
                                                <TableCell className="text-xs text-muted-foreground">{formatDate(ticket.createdAt)}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button asChild variant="link" size="sm">
                                                        <GatedLink href={`/office/repairing/tickets/${ticket.id}`}>View</GatedLink>
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    )
                )}

                {tab === "devices" && (
                    detail.devices.length === 0 ? (
                        <CustomerEmptyState icon={<span className="text-3xl">📱</span>} message="No devices registered yet" />
                    ) : (
                        <Card>
                            <CardContent className="px-0 pt-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Device</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead>Latest Ticket</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Tickets</TableHead>
                                            <TableHead />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {detail.devices.map((device) => {
                                            const latest = device.tickets[0];
                                            return (
                                                <TableRow key={device.id}>
                                                    <TableCell><span className="text-sm font-medium">{device.brand} {device.model}</span></TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">{device.type}</TableCell>
                                                    <TableCell className="font-mono text-xs text-muted-foreground">{latest ? `#${latest.id}` : "—"}</TableCell>
                                                    <TableCell>{latest ? <Badge {...badgeColor(latest.ticketStatus.color)}>{latest.ticketStatus.label}</Badge> : "—"}</TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">{device.tickets.length}</TableCell>
                                                    <TableCell className="text-right">
                                                        {latest && (
                                                            <Button asChild variant="link" size="sm">
                                                                <GatedLink href={`/office/repairing/tickets/${latest.id}`}>View</GatedLink>
                                                            </Button>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    )
                )}

                {/* Companies (of a person) / Contacts (of a company) — link management */}
                {tab === "links" && personDetail && (
                    <CustomerLinkPanel customerId={personDetail.id} links={personDetail.companies} onChanged={handleLinked} />
                )}
                {tab === "links" && companyDetail && (
                    <CompanyLinkPanel companyId={companyDetail.id} links={companyDetail.customers} onChanged={handleLinked} />
                )}

                {tab === "loyalty" && (
                    <LoyaltyPanel accountId={detail.accountId} canManage={canManageLoyalty} />
                )}

                {/* Customer Quality — flag / rating / comments (internal-only) */}
                {tab === "quality" && (
                    <CustomerQualityTab
                        key={`q-${partyKey}`}
                        party={{ kind, id: detail.id }}
                        initialNoDiscount={detail.noDiscount}
                        initialQualityLog={detail.qualityLog}
                        canEditCustomer={canEdit}
                        onSaved={handleSaved}
                    />
                )}

                {/* Outstanding — this party's open bills, settled from here */}
                {tab === "outstanding" && (
                    <PartyOutstandingsPanel
                        key={`o-${detail.accountId}`}
                        accountId={detail.accountId}
                        partyName={detail.name}
                        onChanged={markTxStale}
                    />
                )}

                {tab === "transactions" && (
                    <>
                        {/* Filter bar — matches the account-ledger controls */}
                        <div className="flex flex-wrap items-center gap-3 border-b bg-card px-6 py-2.5">
                            <span className="shrink-0 text-sm font-semibold">Transactions</span>
                            <div className="ml-auto flex flex-wrap items-center gap-2">
                                <label className="text-xs text-muted-foreground">From</label>
                                <TallyDateInput value={from} onValueChange={setFrom} className="h-7 w-36 text-xs" />
                                <label className="text-xs text-muted-foreground">To</label>
                                <TallyDateInput value={to} onValueChange={setTo} monthMode="end" className="h-7 w-36 text-xs" />
                                {/* Where a deliberate re-read says so, now that it no longer
                                    announces itself by blanking the table. */}
                                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => void reloadTransactions()} disabled={txLoading || txRefreshing}>
                                    <RefreshCw size={12} className={cn("mr-1", (txLoading || txRefreshing) && "animate-spin")} />
                                    Refresh
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => window.print()}>
                                    <Printer size={12} />
                                </Button>
                            </div>
                        </div>

                        <div className="p-2">
                            {/* The spinner is for having NOTHING to show, never for a re-read over a
                                statement already on screen (AGENTS.md §7). Saving a bill-wise link from
                                a row's Status chip used to throw the whole table out, collapse the page
                                to a 64px spinner and lose the scroll position — and for nothing: on a
                                counter that immediate read cannot see the new link yet, it is the
                                replica's own quiet re-read a moment later that settles the row. The
                                statement is cleared whenever the selected party changes, so a different
                                party still gets the spinner rather than the last party's rows. Same rule
                                as the Outstanding tab beside it (PartyOutstandingsPanel) and RecycleBin. */}
                            {txLoading && !transactions ? (
                                <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 size={20} className="animate-spin" /></div>
                            ) : !transactions ? null : transactions.invVouchers.length === 0 ? (
                                <CustomerEmptyState icon={<span className="text-3xl">🧾</span>} message="No transactions found" />
                            ) : (
                                <TransactionsTable invVouchers={transactions.invVouchers} accountId={transactions.accountId} onChanged={() => void reloadTransactions()} />
                            )}
                        </div>
                    </>
                )}
            </div>
        </>
    );
}
