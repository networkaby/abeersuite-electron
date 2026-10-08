import Link from "next/link";
import { ChevronRight } from "lucide-react";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import PortalProfileSwitch from "@/modules/external/portal/PortalProfileSwitch";
import AppPeriodPicker from "@/modules/external/shopApp/AppPeriodPicker";
import { requireAppCustomerProfile } from "@/modules/external/shopApp/appSession";
import { APP } from "@/modules/external/shopApp/appPaths";
import { loadPortalOutstanding, loadPortalStatement, type PortalStatementRow } from "@/modules/external/portal/portalStatement";
import { AMBER, GREEN, balanceClass, balanceText, settlementChip, upiDueLink } from "@/modules/external/portal/portalBillFormat";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { businessTodayIso, endOfDayUtc, formatDate, startOfDayUtc, toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { formatInr } from "@/shared/lib/format/moneyInr";

type Tab = "bills" | "ledger" | "outstanding";
const TABS: { id: Tab; label: string }[] = [
    { id: "bills", label: "Bills" },
    { id: "ledger", label: "Ledger" },
    { id: "outstanding", label: "Outstanding" },
];
const PAGE = 50;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * My Bills in the app — every counter and shop bill, the ledger with its running
 * balance, and what is still pending, for the profile in use. Same numbers as
 * the portal (portalStatement.ts, cached a minute); a row opens the bill or the
 * receipt itself.
 */
export default async function CustomerAppBillsPage({
    searchParams,
}: {
    searchParams: Promise<{ tab?: string; from?: string; to?: string; n?: string }>;
}) {
    const sp = await searchParams;
    const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "bills";
    const { customerId, active } = await requireAppCustomerProfile(`${APP}/bills?tab=${tab}`);
    const todayIso = businessTodayIso();
    const fromIso = sp.from && ISO.test(sp.from) ? sp.from : toDateOnlyUtc(indianFiscalYearStart());
    const toIso = sp.to && ISO.test(sp.to) ? sp.to : todayIso;
    const shown = Math.max(PAGE, Number.parseInt(sp.n ?? "", 10) || PAGE);
    const href = (next: Partial<{ tab: Tab; n: number }>) => {
        const q = new URLSearchParams({ tab: next.tab ?? tab, from: fromIso, to: toIso });
        if (next.n) q.set("n", String(next.n));
        return `${APP}/bills?${q}`;
    };

    const [statement, outstanding] = await Promise.all([
        tab === "outstanding" ? null : loadPortalStatement(active, customerId, startOfDayUtc(fromIso), endOfDayUtc(toIso)),
        tab === "outstanding" ? loadPortalOutstanding(active, endOfDayUtc(todayIso)) : null,
    ]);
    const bills = statement ? statement.rows.filter((r) => r.kind === "bill").reverse() : [];
    const ledger = statement ? [...statement.rows].reverse() : [];
    const rows = tab === "bills" ? bills : ledger;

    return (
        <>
            <MobileHeader title="My bills" back={`${APP}/account`} actions={<PortalProfileSwitch className="mr-1" />} />

            <nav className="sticky top-[var(--m-header)] z-10 grid grid-cols-3 border-b bg-background text-sm">
                {TABS.map((t) => (
                    <Link
                        key={t.id}
                        href={href({ tab: t.id })}
                        replace
                        className={`-mb-px border-b-2 py-3 text-center ${t.id === tab ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground"}`}
                    >
                        {t.label}
                    </Link>
                ))}
            </nav>

            {statement && (
                <>
                    <section className="flex items-end justify-between gap-3 bg-background px-4 py-4">
                        <div>
                            <p className="text-xs text-muted-foreground">{statement.closing < -0.005 ? "Advance with us" : "Balance due"}</p>
                            <p className={`text-2xl font-bold tabular-nums ${balanceClass(statement.closing)}`}>{formatInr(Math.abs(statement.closing))}</p>
                            <p className="text-xs text-muted-foreground">
                                {bills.length} {bills.length === 1 ? "bill" : "bills"} · bought {formatInr(bills.reduce((s, r) => s + r.total, 0))}
                            </p>
                        </div>
                        <AppPeriodPicker fromIso={fromIso} toIso={toIso} todayIso={todayIso} tab={tab} />
                    </section>
                    {rows.length === 0 ? (
                        <p className="px-6 py-14 text-center text-sm text-muted-foreground">Nothing in this period.</p>
                    ) : (
                        <ul className="mt-2 divide-y bg-background">
                            {rows.slice(0, shown).map((r) => (
                                <li key={r.key}>
                                    <Row row={r} ledger={tab === "ledger"} />
                                </li>
                            ))}
                        </ul>
                    )}
                    {rows.length > shown && (
                        <Link href={href({ n: shown + PAGE })} scroll={false} replace className="block py-4 text-center text-sm font-medium text-primary">
                            Show older
                        </Link>
                    )}
                    {tab === "ledger" && (
                        <p className="px-4 py-3 text-xs text-muted-foreground">Bills paid in full at the counter do not change your balance, so they are listed under Bills only.</p>
                    )}
                </>
            )}

            {outstanding && (
                <>
                    <section className="space-y-3 bg-background px-4 py-4">
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <Stat label="Total due" value={formatInr(outstanding.totalDue)} tone={balanceClass(outstanding.totalDue)} />
                            <Stat label="Advance" value={formatInr(outstanding.advance)} tone={balanceClass(-outstanding.advance)} />
                            <Stat label="Oldest" value={outstanding.oldestDays == null ? "—" : `${outstanding.oldestDays} days`} />
                        </div>
                        {(() => {
                            const upi = outstanding.totalDue > 0 ? upiDueLink(outstanding.totalDue, active.label) : null;
                            return upi ? (
                                <a href={upi} className="flex h-12 items-center justify-center rounded-xl bg-emerald-600 text-[15px] font-semibold text-white active:bg-emerald-700">
                                    Pay {formatInr(outstanding.totalDue)} by UPI
                                </a>
                            ) : null;
                        })()}
                        {outstanding.totalDue > 0 && <p className="text-center text-xs text-muted-foreground">Opens your UPI app. Your balance updates once the shop records it.</p>}
                    </section>
                    {outstanding.bills.length === 0 ? (
                        <p className="px-6 py-14 text-center text-sm text-muted-foreground">No bills pending. Thank you!</p>
                    ) : (
                        <ul className="mt-2 divide-y bg-background">
                            {outstanding.bills.map((b, i) => (
                                <li key={`${b.uvId ?? "x"}-${i}`}>
                                    <Wrap uvId={b.uvId}>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium">{b.reference || b.label}</span>
                                            <span className="block text-xs text-muted-foreground">
                                                {formatDate(b.billDate)} · of {formatInr(b.total)} · {b.days} days
                                            </span>
                                        </span>
                                        <span className={`shrink-0 text-sm font-semibold tabular-nums ${AMBER}`}>{formatInr(b.pending)}</span>
                                    </Wrap>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </>
    );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
    return (
        <div className="rounded-xl bg-muted/50 px-2 py-2.5">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</p>
        </div>
    );
}

/** A row that opens its document when it has one (bills and receipts do). */
function Wrap({ uvId, children }: { uvId: number | null; children: React.ReactNode }) {
    const cls = "flex items-center gap-3 px-4 py-3";
    return uvId != null ? (
        <Link href={`${APP}/b/${uvId}`} className={`${cls} active:bg-muted`}>
            {children}
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
    ) : (
        <div className={cls}>{children}</div>
    );
}

function Row({ row: r, ledger }: { row: PortalStatementRow; ledger: boolean }) {
    const chip = settlementChip(r);
    return (
        <Wrap uvId={r.linkable ? r.uvId : null}>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.reference || r.label}</span>
                <span className="block text-xs text-muted-foreground">
                    {formatDate(r.date)}
                    {r.reference ? ` · ${r.label}` : ""}
                </span>
            </span>
            <span className="shrink-0 text-right">
                {ledger ? (
                    <>
                        <span className={`block text-sm font-semibold tabular-nums ${r.movement < -0.005 ? GREEN : ""}`}>
                            {r.movement > 0.005 ? formatInr(r.movement) : r.movement < -0.005 ? `−${formatInr(-r.movement)}` : "—"}
                        </span>
                        <span className={`block text-[11px] tabular-nums ${balanceClass(r.balance)}`}>{balanceText(r.balance)}</span>
                    </>
                ) : (
                    <>
                        <span className="block text-sm font-semibold tabular-nums">{formatInr(r.total)}</span>
                        {chip && <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[11px] ${chip.tone}`}>{chip.text}</span>}
                    </>
                )}
            </span>
        </Wrap>
    );
}
