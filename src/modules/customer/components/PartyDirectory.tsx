"use client";

// The Contacts screen — one screen for persons and companies alike. All, Person
// and Companies are the same screen with a different filter (`scope`), so they
// carry the same features: the same list, search, sort, and the same detail pane
// (PartyDetailPane).
//
// A search on Person or Companies also looks in the other kind and lists those
// hits under their own heading, so a party looked for on the wrong page is still
// one click away — it opens right here.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Building2, Plus, User, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityListPanel } from "@/shared/components/EntityListPanel";
import { BreadcrumbBar } from "@/shared/components/BreadcrumbBar";
import { GatedLink } from "@/shared/components/GatedLink";
import CreatePersonDialog from "@/shared/components/CreatePersonDialog";
import CreateCompanyDialog from "@/shared/components/CreateCompanyDialog";
import { useDebouncedValue, useEscape, usePartyBrowseList, useRealtimeTopics, useSessionState, type BrowseListRow } from "@/shared/hooks";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";
import type { Party } from "@/shared/lib/parties";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { moduleSelectedStyle, moduleTint } from "@/shared/lib/format/moduleTheme";
import { cn } from "@/shared/lib/format/utils";
import { ToLinkChip } from "@/modules/accountancy/components/ToLinkChip";
import { DEFAULT_PARTY_SORT, sortParties, type PartySort } from "@/modules/customer/lib/partySort";
import { PartySortToggle } from "@/modules/customer/components/PartySortToggle";
import { PartyInactiveToggle } from "@/modules/customer/components/PartyInactiveToggle";
import { PartyAvatar } from "@/modules/customer/components/PartyAvatar";
import { PartyBalanceChip } from "@/modules/customer/components/PartyBalanceChip";
import CustomerEmptyState from "@/modules/customer/components/CustomerEmptyState";
import { PartyDetailPane, type PartyRef } from "@/modules/customer/components/PartyDetailPane";
import type { PartyKind } from "@/modules/customer/hooks/usePartyProfile";

export type DirectoryScope = "all" | PartyKind;

const SCOPES: { scope: DirectoryScope; label: string; crumb: string; href: string }[] = [
    { scope: "all", label: "All", crumb: "All", href: "/office/customers/all" },
    { scope: "person", label: "Person", crumb: "Persons", href: "/office/customers/person" },
    { scope: "company", label: "Companies", crumb: "Companies", href: "/office/customers/companies" },
];

/** A row of /api/person or /api/companies, as this list draws it. */
interface PartyListItem extends BrowseListRow {
    phone: string | null;
    _count?: { devices?: number; customers?: number };
    /** `balance`/`normalBalance` are null ONLY on a `fromCache` placeholder row —
     *  the cache carries identity, never money — and the row renders them as
     *  pending rather than as a number. A live row always has both. */
    account: { id: number; balance: number | null; normalBalance: "DEBIT" | "CREDIT" | null; toLink?: number } | null;
}

type Row = PartyListItem & { kind: PartyKind };

/** A cached party as a list row, for the instant paint before the first live
 *  page lands. Money is left null on purpose — see `PartyListItem.account`.
 *  Module scope so its identity is stable across renders. */
const placeholderFromCache = (p: Party): PartyListItem => ({
    id: p.id,
    name: p.name,
    // The cache only ever holds active parties.
    isActive: true,
    phone: p.phones[0] ?? null,
    account: p.accountId ? { id: p.accountId, balance: null, normalBalance: null } : null,
    fromCache: true,
});

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

export function PartyDirectory({ scope }: { scope: DirectoryScope }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const canOpen = useCanOpenPage();
    const { data: session } = useSession();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    // hasPermissionWithScope covers admin:bypass AND the CRUD ladder (only the
    // highest rung is stored — e.g. customers:delete implies edit). Persons and
    // companies share the Contacts (customers:*) permission set.
    const canManageUsers = hasPermissionWithScope(perms, PERMISSIONS.USERS_EDIT);
    const canManageLoyalty = hasPermissionWithScope(perms, PERMISSIONS.LOYALTY_EDIT);
    const canEdit = hasPermissionWithScope(perms, PERMISSIONS.CUSTOMERS_EDIT);
    const canDelete = hasPermissionWithScope(perms, PERMISSIONS.CUSTOMERS_DELETE);
    // Without this grant the lists hide suppliers (Sundry Creditors) — customers only.
    const canSeeCreditors = hasPermissionWithScope(perms, PERMISSIONS.CUSTOMERS_VIEW_CREDITORS);

    const [sort, setSort] = useState<PartySort>(DEFAULT_PARTY_SORT);
    const [showInactive, setShowInactive] = useState(false);
    // A switch between All / Person / Companies carries the search box along.
    const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
    const debouncedSearch = useDebouncedValue(search, 300).trim();
    const searching = debouncedSearch !== "";

    // Open party, its tab, period and scroll come back after Back from a voucher.
    const stateKey = `contacts:${scope}`;
    const [selected, setSelected] = useSessionState<PartyRef | null>(`${stateKey}:selected`, null);

    // Day Book, registers and the [accountId] redirect link here with
    // ?personId= / ?companyId= so the party opens already selected.
    useEffect(() => {
        const personId = Number(searchParams.get("personId"));
        const companyId = Number(searchParams.get("companyId"));
        if (personId) setSelected({ kind: "person", id: personId });
        else if (companyId) setSelected({ kind: "company", id: companyId });
    }, [searchParams, setSelected]);

    // Server-side search: each list holds only what its API returns for the
    // current query — name, phone, email / reg and the ledger's keywords. Empty
    // query → 50 at a time, growing as the panel is scrolled (usePartyBrowseList).
    // The other kind is asked for only while a search is typed.
    const listOpts = {
        search: debouncedSearch,
        sort,
        hideCreditors: !canSeeCreditors,
        includeInactive: showInactive,
    };
    const persons = usePartyBrowseList<PartyListItem>({
        ...listOpts,
        type: "customer",
        apiPath: "/api/person",
        errorMessage: "Failed to load customers",
        cachePlaceholder: scope === "company" ? undefined : placeholderFromCache,
        enabled: scope !== "company" || searching,
    });
    const companies = usePartyBrowseList<PartyListItem>({
        ...listOpts,
        type: "company",
        apiPath: "/api/companies",
        errorMessage: "Failed to load companies",
        cachePlaceholder: scope === "person" ? undefined : placeholderFromCache,
        enabled: scope !== "person" || searching,
    });

    const refreshPersons = persons.refresh;
    const refreshCompanies = companies.refresh;
    const refreshAll = useCallback(() => { void refreshPersons(); void refreshCompanies(); }, [refreshPersons, refreshCompanies]);
    // A party added or renamed on another machine appears here without F5.
    useRealtimeTopics(["parties"], refreshAll);

    const loadMorePersons = persons.loadMore;
    const loadMoreCompanies = companies.loadMore;
    const loadMore = useCallback(() => {
        if (scope !== "company") loadMorePersons();
        if (scope !== "person") loadMoreCompanies();
    }, [scope, loadMorePersons, loadMoreCompanies]);

    const sortRows = useCallback(
        (rows: Row[]) => sortParties(rows, sort, { name: (r) => r.name, balance: (r) => r.account?.balance ?? 0 }),
        [sort],
    );
    const personRows = useMemo<Row[]>(() => persons.items.map((p) => ({ ...p, kind: "person" })), [persons.items]);
    const companyRows = useMemo<Row[]>(() => companies.items.map((c) => ({ ...c, kind: "company" })), [companies.items]);

    // `main` is this page's own kind (both, on All); `others` the other kind's
    // search hits, drawn under their own heading.
    const { main, others } = useMemo(() => {
        if (scope === "person") return { main: sortRows(personRows), others: sortRows(companyRows) };
        if (scope === "company") return { main: sortRows(companyRows), others: sortRows(personRows) };
        // All: two name-ordered lists, each a page at a time. Past the last loaded
        // name of a list that has more to come, the other list's rows would sit out
        // of order (its own next page belongs before them) — hold them back until
        // that page lands.
        let merged = sortRows([...personRows, ...companyRows]);
        const paged = sort.key === "name" && sort.dir === "asc";
        if (paged) {
            const cutoffs = [
                persons.hasMore ? personRows.at(-1)?.name : undefined,
                companies.hasMore ? companyRows.at(-1)?.name : undefined,
            ].filter((n): n is string => n !== undefined);
            if (cutoffs.length) {
                const cutoff = cutoffs.sort(byName)[0];
                merged = merged.filter((r) => byName(r.name, cutoff) <= 0);
            }
        }
        return { main: merged, others: [] as Row[] };
    }, [scope, personRows, companyRows, sortRows, sort, persons.hasMore, companies.hasMore]);

    const updatePerson = persons.updateItem;
    const updateCompany = companies.updateItem;
    const handleRenamed = useCallback((party: PartyRef, name: string) => {
        (party.kind === "person" ? updatePerson : updateCompany)(party.id, { name });
    }, [updatePerson, updateCompany]);
    // Deleted (hard) or deactivated — either way it drops out of the isActive
    // list, so close the detail and reload.
    const handleDeleted = useCallback(() => { setSelected(null); refreshAll(); }, [setSelected, refreshAll]);

    const [creating, setCreating] = useState<PartyKind | null>(null);
    const handleCreated = useCallback((kind: PartyKind, id: number) => {
        refreshAll();
        setSelected({ kind, id });
    }, [refreshAll, setSelected]);

    // Esc closes the open party first, then goes back. An open dialog or menu takes
    // its own Esc first (see useEscape).
    useEscape(() => {
        if (selected !== null) setSelected(null);
        else router.back();
    });

    const here = SCOPES.find((s) => s.scope === scope)!;
    const otherLabel = scope === "person" ? "Companies" : "Persons";
    const loadingMore = persons.loadingMore || companies.loadingMore;

    const renderRow = (row: Row, showKind: boolean) => {
        const isOpen = selected?.kind === row.kind && selected.id === row.id;
        const linkCount = row.kind === "person" ? row._count?.devices : row._count?.customers;
        const KindIcon = row.kind === "person" ? User : Building2;
        return (
            <Button
                key={`${row.kind}-${row.id}`}
                asChild
                variant="ghost"
                className={cn("h-auto w-full justify-start rounded-none border-b px-4 py-3", !row.isActive && "opacity-50")}
                style={isOpen ? moduleSelectedStyle("customers") : undefined}
            >
                <Link
                    href={`/office/customers/${row.account?.id ?? "#"}`}
                    onClick={(e) => {
                        // Ctrl / middle click still opens the party in a new tab.
                        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
                        e.preventDefault();
                        setSelected({ kind: row.kind, id: row.id });
                    }}
                >
                    <div className="flex w-full items-center gap-3 text-left">
                        <PartyAvatar name={row.name} />
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{row.name}</p>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                                <p className="truncate text-xs text-muted-foreground">{row.phone || "No phone"}</p>
                                {row.account && (
                                    <span className="flex shrink-0 items-center gap-1">
                                        <ToLinkChip toLink={row.account.toLink ?? 0} compact />
                                        <PartyBalanceChip balance={row.account.balance} normalBalance={row.account.normalBalance} />
                                    </span>
                                )}
                            </div>
                        </div>
                        {!row.isActive && (
                            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                Inactive
                            </span>
                        )}
                        {!showKind && !!linkCount && (
                            <span className="text-xs text-muted-foreground">{linkCount}{row.kind === "person" ? "d" : "c"}</span>
                        )}
                        {showKind && (
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                <KindIcon size={10} className="mr-1" />
                                {row.kind === "person" ? "Person" : "Company"}
                            </Badge>
                        )}
                    </div>
                </Link>
            </Button>
        );
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-card">
            <BreadcrumbBar className="flex items-center gap-2 py-2">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => router.back()} title="Back (Esc)">
                    <ArrowLeft size={15} />
                </Button>
                <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    {searchParams.get("from") === "daybook" && (
                        <>
                            <GatedLink whenLocked="text" href="/office/accountancy/reports/day-book" className="transition-colors hover:text-foreground">Day Book</GatedLink>
                            <span>/</span>
                        </>
                    )}
                    <Link href="/office/customers" className="transition-colors hover:text-foreground">Customers</Link>
                    <span>/</span>
                    <span className="font-medium text-foreground">{here.crumb}</span>
                </nav>
            </BreadcrumbBar>

            <div className="flex flex-1 overflow-hidden">
                <EntityListPanel
                    title={scope === "all" ? "All Contacts" : here.label}
                    icon={scope === "company" ? <Building2 size={16} className="text-primary" /> : scope === "person" ? <User size={16} className="text-primary" /> : <Users size={16} className="text-primary" />}
                    count={main.length}
                    search={search}
                    onSearchChange={setSearch}
                    searchPlaceholder={scope === "company" ? "Search name, phone, reg, keyword…" : "Search name, phone, keyword…"}
                    onAdd={scope === "all" ? undefined : () => setCreating(scope)}
                    toolbar={
                        <div className="flex flex-col gap-2">
                            {/* All / Person / Companies — the same list, filtered. */}
                            <div className="flex items-center gap-1">
                                {SCOPES.filter((s) => s.scope === scope || canOpen(s.href)).map((s) => (
                                    <Button
                                        key={s.scope}
                                        asChild
                                        size="sm"
                                        variant={s.scope === scope ? "secondary" : "ghost"}
                                        className="h-6 px-2 text-xs"
                                    >
                                        <Link href={search.trim() ? `${s.href}?q=${encodeURIComponent(search.trim())}` : s.href}>{s.label}</Link>
                                    </Button>
                                ))}
                                {scope === "all" && (
                                    <span className="ml-auto flex gap-1">
                                        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setCreating("person")}>
                                            <Plus size={12} /> Person
                                        </Button>
                                        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setCreating("company")}>
                                            <Plus size={12} /> Company
                                        </Button>
                                    </span>
                                )}
                            </div>
                            <div className="flex justify-between">
                                <PartySortToggle sort={sort} onChange={setSort} />
                                <PartyInactiveToggle checked={showInactive} onChange={setShowInactive} visible={canDelete} />
                            </div>
                        </div>
                    }
                    isEmpty={main.length === 0 && others.length === 0}
                    emptyMessage={search ? "No matches" : "No contacts yet"}
                    onScrollNearBottom={loadMore}
                >
                    {main.map((row) => renderRow(row, scope === "all"))}
                    {main.length === 0 && others.length > 0 && (
                        <p className="px-4 py-3 text-center text-xs text-muted-foreground">No {here.crumb.toLowerCase()} match</p>
                    )}
                    {others.length > 0 && (
                        <>
                            <p className="border-b bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                                Also in {otherLabel} ({others.length})
                            </p>
                            {others.map((row) => renderRow(row, true))}
                        </>
                    )}
                    {loadingMore && (
                        <p className="py-3 text-center text-xs text-muted-foreground">Loading more…</p>
                    )}
                </EntityListPanel>

                <section className="flex flex-1 flex-col overflow-hidden" style={{ backgroundColor: moduleTint("customers", 6) }}>
                    {selected ? (
                        <PartyDetailPane
                            key={`${selected.kind}:${selected.id}`}
                            party={selected}
                            stateKey={stateKey}
                            canEdit={canEdit}
                            canDelete={canDelete}
                            canManageUsers={canManageUsers}
                            canManageLoyalty={canManageLoyalty}
                            onOpen={setSelected}
                            onRenamed={handleRenamed}
                            onDeleted={handleDeleted}
                            onReactivated={refreshAll}
                        />
                    ) : (
                        <CustomerEmptyState
                            icon={scope === "company" ? <Building2 size={40} strokeWidth={1} /> : <User size={40} strokeWidth={1} />}
                            message="Select a contact from the list to open details"
                        />
                    )}
                </section>
            </div>

            <CreatePersonDialog
                open={creating === "person"}
                onOpenChange={(open) => { if (!open) setCreating(null); }}
                onCreated={(id) => handleCreated("person", id)}
            />
            <CreateCompanyDialog
                open={creating === "company"}
                onOpenChange={(open) => { if (!open) setCreating(null); }}
                onCreated={(id) => handleCreated("company", id)}
            />
        </div>
    );
}
