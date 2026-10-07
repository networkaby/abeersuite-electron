import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { Receipt } from "lucide-react";
import PortalShopButton from "@/modules/external/portal/PortalShopButton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import { PORTAL_ACTIVE_ACCOUNT_COOKIE, resolvePortalAccountContext } from "@/shared/lib/auth/portalAccountContext";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { businessTodayIso, endOfDayUtc, formatDate, startOfDayUtc, toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { formatInr } from "@/shared/lib/format/moneyInr";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { upiProvider } from "@/modules/pos/lib/paymentLink";
import { QrSvg } from "@/shared/components/print/QrSvg";
import {
    loadPortalOutstanding,
    loadPortalStatement,
    type PortalStatementRow,
} from "@/modules/external/portal/portalStatement";

// My Bills — the customer's shop bills, ledger with running balance, and what
// is still pending, for the profile picked in the header ("Using …"). Bills
// bought at the counter or in the office never appear under My Orders (that
// page is website orders only), so without this page a regular walk-in
// customer saw "No orders yet" despite years of purchases.
//
// Phones get a two-line list per row (md:hidden); the wide table is md+ only,
// so nothing ever scrolls sideways on a phone.

type Tab = "bills" | "ledger" | "outstanding";
const TABS: { id: Tab; label: string }[] = [
    { id: "bills", label: "Bills" },
    { id: "ledger", label: "Ledger" },
    { id: "outstanding", label: "Outstanding" },
];
const PAGE = 50;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const AMBER = "text-amber-700 dark:text-amber-400";
const GREEN = "text-emerald-700 dark:text-emerald-400";

/** + is what they owe, − is an advance with us — said in words, not Dr/Cr. */
function balanceText(n: number) {
    if (Math.abs(n) < 0.005) return formatInr(0);
    return n > 0 ? `${formatInr(n)} due` : `${formatInr(-n)} adv`;
}

function balanceClass(n: number) {
    if (Math.abs(n) < 0.005) return "";
    return n > 0 ? AMBER : GREEN;
}

function StatusChip({ row }: { row: PortalStatementRow }) {
    if (row.settlement == null) return null;
    const settled = row.settlement === "SETTLED";
    const text = settled
        ? (row.kind === "payment" ? "Used" : "Paid")
        : row.kind === "payment" || row.kind === "return"
            ? `${formatInr(row.open)} unused`
            : `${formatInr(row.open)} due`;
    const tone = settled
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    return <span className={`rounded px-2 py-0.5 text-xs whitespace-nowrap ${tone}`}>{text}</span>;
}

function RefCell({ uvId, linkable, reference, label }: { uvId: number | null; linkable: boolean; reference: string; label: string }) {
    return (
        <div className="min-w-0">
            {linkable && uvId != null ? (
                <Link href={`/portal/b/${uvId}`} className="font-mono text-sm text-primary hover:underline break-all">{reference}</Link>
            ) : (
                <span className="font-mono text-sm break-all">{reference || label}</span>
            )}
            {reference ? <div className="text-xs text-muted-foreground">{label}</div> : null}
        </div>
    );
}

/** Phone layout: one row = two lines, nothing to scroll sideways. */
function MobileRow({ left, right, sub, subRight }: {
    left: React.ReactNode;
    right: React.ReactNode;
    sub: React.ReactNode;
    subRight?: React.ReactNode;
}) {
    return (
        <li className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
                {left}
                <div className="shrink-0 text-right text-sm font-medium tabular-nums">{right}</div>
            </div>
            <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{sub}</span>
                {subRight ?? null}
            </div>
        </li>
    );
}

function SummaryCard({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
    return (
        <div className="rounded-lg bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`text-base font-semibold tabular-nums sm:text-lg ${tone}`}>{value}</div>
        </div>
    );
}

export default async function PortalBillsPage({
    searchParams,
}: {
    searchParams: Promise<{ tab?: string; from?: string; to?: string; n?: string }>;
}) {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    const customerId = parseInt((session?.user as { customerId?: string } | undefined)?.customerId ?? "", 10);
    if (!session?.user || kind !== "customer" || !Number.isFinite(customerId)) {
        redirect("/login?callbackUrl=/portal/bills");
    }

    const cookieStore = await cookies();
    const rawAccountId = Number(cookieStore.get(PORTAL_ACTIVE_ACCOUNT_COOKIE)?.value);
    let context: Awaited<ReturnType<typeof resolvePortalAccountContext>>;
    try {
        context = await resolvePortalAccountContext(customerId, Number.isFinite(rawAccountId) ? rawAccountId : null);
    } catch {
        redirect("/portal");
    }
    const active = context.active;

    const sp = await searchParams;
    const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "bills";
    const todayIso = businessTodayIso();
    const fromIso = sp.from && ISO.test(sp.from) ? sp.from : toDateOnlyUtc(indianFiscalYearStart());
    const toIso = sp.to && ISO.test(sp.to) ? sp.to : todayIso;
    const shown = Math.max(PAGE, Number.parseInt(sp.n ?? "", 10) || PAGE);

    const hrefFor = (next: Partial<{ tab: Tab; n: number }>) => {
        const q = new URLSearchParams({ tab: next.tab ?? tab, from: fromIso, to: toIso });
        if (next.n) q.set("n", String(next.n));
        return `/portal/bills?${q}`;
    };

    const [statement, outstanding] = await Promise.all([
        tab === "outstanding" ? null : loadPortalStatement(active, customerId, startOfDayUtc(fromIso), endOfDayUtc(toIso)),
        tab === "outstanding" ? loadPortalOutstanding(active, endOfDayUtc(todayIso)) : null,
    ]);

    const bills = statement ? statement.rows.filter((r) => r.kind === "bill").reverse() : [];
    const ledger = statement ? [...statement.rows].reverse() : [];
    const purchase = bills.reduce((s, r) => s + r.total, 0);
    const dateBox = "h-9 w-full rounded-md border border-input bg-background px-2 text-foreground sm:w-auto";

    return (
        <main className="px-4 py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                <PortalSectionHeader
                    title="My Bills"
                    description={`Shop and counter bills, payments and balance for ${active.label}.`}
                    icon={Receipt}
                />

                <nav className="grid grid-cols-3 border-b border-border text-sm sm:flex sm:gap-1">
                    {TABS.map((t) => (
                        <Link
                            key={t.id}
                            href={hrefFor({ tab: t.id })}
                            className={`-mb-px border-b-2 px-3 py-2.5 text-center ${t.id === tab ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                        >
                            {t.label}
                        </Link>
                    ))}
                </nav>

                {tab !== "outstanding" && statement ? (
                    <>
                        <form className="grid grid-cols-2 gap-2 text-sm text-muted-foreground sm:flex sm:flex-wrap sm:items-center" action="/portal/bills">
                            <input type="hidden" name="tab" value={tab} />
                            <label className="space-y-1 sm:flex sm:items-center sm:gap-2 sm:space-y-0">
                                <span className="block">From</span>
                                <input type="date" name="from" defaultValue={fromIso} max={todayIso} className={dateBox} />
                            </label>
                            <label className="space-y-1 sm:flex sm:items-center sm:gap-2 sm:space-y-0">
                                <span className="block">To</span>
                                <input type="date" name="to" defaultValue={toIso} max={todayIso} className={dateBox} />
                            </label>
                            <Button type="submit" size="sm" variant="outline" className="col-span-2 h-9 sm:col-span-1">Show</Button>
                        </form>

                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                            <SummaryCard
                                label={statement.closing < 0 ? "Advance with us" : "Balance due"}
                                value={formatInr(Math.abs(statement.closing))}
                                tone={balanceClass(statement.closing)}
                            />
                            <SummaryCard label="Bills in this period" value={String(bills.length)} />
                            <div className="col-span-2 md:col-span-1">
                                <SummaryCard label="Total purchase" value={formatInr(purchase)} />
                            </div>
                        </div>
                    </>
                ) : null}

                {tab === "bills" && statement ? (
                    <Card className="border-border/70">
                        <CardContent className="p-0">
                            {bills.length === 0 ? (
                                <div className="space-y-3 p-8 text-center text-sm text-muted-foreground">
                                    <p>No bills in this period.</p>
                                    <PortalShopButton variant="outline" />
                                </div>
                            ) : (
                                <>
                                    <ul className="divide-y divide-border/60 md:hidden">
                                        {bills.slice(0, shown).map((r) => (
                                            <MobileRow
                                                key={r.key}
                                                left={<RefCell {...r} />}
                                                right={formatInr(r.total)}
                                                sub={`${formatDate(r.date)} · paid ${formatInr(r.paid)}`}
                                                subRight={<StatusChip row={r} />}
                                            />
                                        ))}
                                    </ul>
                                    <table className="hidden w-full text-sm md:table">
                                        <thead className="text-left text-xs text-muted-foreground">
                                            <tr>
                                                <th className="px-4 py-2 font-medium">Bill</th>
                                                <th className="px-2 py-2 font-medium">Date</th>
                                                <th className="px-2 py-2 text-right font-medium">Total</th>
                                                <th className="px-2 py-2 text-right font-medium">Paid at counter</th>
                                                <th className="px-4 py-2 font-medium">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {bills.slice(0, shown).map((r) => (
                                                <tr key={r.key} className="border-t border-border/60">
                                                    <td className="px-4 py-2"><RefCell {...r} /></td>
                                                    <td className="px-2 py-2 whitespace-nowrap">{formatDate(r.date)}</td>
                                                    <td className="px-2 py-2 text-right tabular-nums">{formatInr(r.total)}</td>
                                                    <td className="px-2 py-2 text-right tabular-nums">{formatInr(r.paid)}</td>
                                                    <td className="px-4 py-2"><StatusChip row={r} /></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </>
                            )}
                        </CardContent>
                    </Card>
                ) : null}

                {tab === "ledger" && statement ? (
                    <Card className="border-border/70">
                        <CardContent className="p-0">
                            <ul className="divide-y divide-border/60 md:hidden">
                                <li className="flex justify-between px-4 py-3 text-sm font-medium">
                                    <span>Closing balance</span>
                                    <span className={`tabular-nums ${balanceClass(statement.closing)}`}>{balanceText(statement.closing)}</span>
                                </li>
                                {ledger.slice(0, shown).map((r) => (
                                    <MobileRow
                                        key={r.key}
                                        left={<RefCell {...r} />}
                                        right={
                                            r.movement > 0.005 ? `+${formatInr(r.movement)}`
                                                : r.movement < -0.005 ? <span className={GREEN}>−{formatInr(-r.movement)}</span> : "—"
                                        }
                                        sub={formatDate(r.date)}
                                        subRight={<span className={`tabular-nums ${balanceClass(r.balance)}`}>Bal {balanceText(r.balance)}</span>}
                                    />
                                ))}
                                {statement.rows.length === 0 ? (
                                    <li className="p-8 text-center text-sm text-muted-foreground">Nothing in this period.</li>
                                ) : null}
                            </ul>
                            <table className="hidden w-full text-sm md:table">
                                <thead className="text-left text-xs text-muted-foreground">
                                    <tr>
                                        <th className="px-4 py-2 font-medium">Date</th>
                                        <th className="px-2 py-2 font-medium">Particulars</th>
                                        <th className="px-2 py-2 text-right font-medium">Bill (you owe)</th>
                                        <th className="px-2 py-2 text-right font-medium">Paid / credit</th>
                                        <th className="px-4 py-2 text-right font-medium">Balance</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="border-t border-border/60 font-medium">
                                        <td className="px-4 py-2" />
                                        <td className="px-2 py-2">Closing balance</td>
                                        <td className="px-2 py-2" />
                                        <td className="px-2 py-2" />
                                        <td className={`px-4 py-2 text-right tabular-nums ${balanceClass(statement.closing)}`}>{balanceText(statement.closing)}</td>
                                    </tr>
                                    {ledger.slice(0, shown).map((r) => (
                                        <tr key={r.key} className={`border-t border-border/60 ${r.kind === "opening" ? "bg-muted/40" : ""}`}>
                                            <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.date)}</td>
                                            <td className="px-2 py-2"><RefCell {...r} /></td>
                                            <td className="px-2 py-2 text-right tabular-nums">{r.movement > 0.005 ? formatInr(r.movement) : ""}</td>
                                            <td className="px-2 py-2 text-right tabular-nums">{r.movement < -0.005 ? formatInr(-r.movement) : ""}</td>
                                            <td className={`px-4 py-2 text-right tabular-nums ${balanceClass(r.balance)}`}>{balanceText(r.balance)}</td>
                                        </tr>
                                    ))}
                                    {statement.rows.length === 0 ? (
                                        <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Nothing in this period.</td></tr>
                                    ) : null}
                                </tbody>
                            </table>
                            <p className="px-4 py-2 text-xs text-muted-foreground">
                                Bills paid in full at the counter do not change your balance, so they are listed under Bills only.
                            </p>
                        </CardContent>
                    </Card>
                ) : null}

                {tab === "outstanding" && outstanding ? (
                    <>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                            <SummaryCard label="Total due" value={formatInr(outstanding.totalDue)} tone={balanceClass(outstanding.totalDue)} />
                            <SummaryCard label="Advance not yet used" value={formatInr(outstanding.advance)} tone={balanceClass(-outstanding.advance)} />
                            <div className="col-span-2 md:col-span-1">
                                <SummaryCard label="Oldest due" value={outstanding.oldestDays == null ? "—" : `${outstanding.oldestDays} days`} />
                            </div>
                        </div>
                        {/* Pay the whole due by UPI — the button a due reminder's "Pay now" lands on.
                            Phone: opens any UPI app pre-filled. Desktop: scan the QR. Staff still
                            post the receipt when the money shows in the bank. */}
                        {outstanding.totalDue > 0 && COMPANY_DETAILS.bank.upiVpa ? (() => {
                            const upi = upiProvider.build(
                                { upiVpa: COMPANY_DETAILS.bank.upiVpa, payeeName: COMPANY_DETAILS.upi.payeeName },
                                { amountRupees: outstanding.totalDue, note: `Due ${active.label}`.slice(0, 50) },
                            );
                            return (
                                <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40">
                                    <CardContent className="flex flex-col items-center gap-3 p-4 text-center sm:flex-row sm:justify-between sm:text-left">
                                        <div className="space-y-2">
                                            <p className="text-sm">Pay your due of <b>{formatInr(outstanding.totalDue)}</b> by any UPI app.</p>
                                            <Button asChild className="w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto">
                                                <a href={upi}>Pay {formatInr(outstanding.totalDue)} by UPI</a>
                                            </Button>
                                            <p className="text-xs text-muted-foreground">Pays to {COMPANY_DETAILS.bank.upiVpa}. Your balance updates once the shop records it.</p>
                                        </div>
                                        <QrSvg value={upi} size={120} className="hidden rounded bg-white p-1 sm:block" />
                                    </CardContent>
                                </Card>
                            );
                        })() : null}
                        <Card className="border-border/70">
                            <CardContent className="p-0">
                                {outstanding.bills.length === 0 ? (
                                    <p className="p-8 text-center text-sm text-muted-foreground">No bills pending. Thank you!</p>
                                ) : (
                                    <>
                                        <ul className="divide-y divide-border/60 md:hidden">
                                            {outstanding.bills.map((b, i) => (
                                                <MobileRow
                                                    key={`${b.uvId ?? "x"}-${i}`}
                                                    left={<RefCell uvId={b.uvId} linkable={b.uvId != null} reference={b.reference} label={b.label} />}
                                                    right={<span className={AMBER}>{formatInr(b.pending)}</span>}
                                                    sub={`${formatDate(b.billDate)} · of ${formatInr(b.total)}`}
                                                    subRight={<span>{b.days} days</span>}
                                                />
                                            ))}
                                        </ul>
                                        <table className="hidden w-full text-sm md:table">
                                            <thead className="text-left text-xs text-muted-foreground">
                                                <tr>
                                                    <th className="px-4 py-2 font-medium">Bill</th>
                                                    <th className="px-2 py-2 font-medium">Date</th>
                                                    <th className="px-2 py-2 text-right font-medium">Amount</th>
                                                    <th className="px-2 py-2 text-right font-medium">Pending</th>
                                                    <th className="px-4 py-2 text-right font-medium">Days</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {outstanding.bills.map((b, i) => (
                                                    <tr key={`${b.uvId ?? "x"}-${i}`} className="border-t border-border/60">
                                                        <td className="px-4 py-2"><RefCell uvId={b.uvId} linkable={b.uvId != null} reference={b.reference} label={b.label} /></td>
                                                        <td className="px-2 py-2 whitespace-nowrap">{formatDate(b.billDate)}</td>
                                                        <td className="px-2 py-2 text-right tabular-nums">{formatInr(b.total)}</td>
                                                        <td className={`px-2 py-2 text-right tabular-nums ${AMBER}`}>{formatInr(b.pending)}</td>
                                                        <td className="px-4 py-2 text-right tabular-nums">{b.days}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </>
                ) : null}

                {tab !== "outstanding" && (tab === "bills" ? bills.length : ledger.length) > shown ? (
                    <div className="text-center">
                        <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                            <Link href={hrefFor({ n: shown + PAGE })} scroll={false}>Load older</Link>
                        </Button>
                    </div>
                ) : null}

                <Card className="border-yellow-300 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/40">
                    <CardContent className="flex flex-col items-center gap-3 p-4 text-center text-sm sm:flex-row sm:justify-between sm:text-left">
                        <span>Need something new? Order online — pick up at the shop or get it delivered.</span>
                        <PortalShopButton className="w-full sm:w-auto" />
                    </CardContent>
                </Card>
            </div>
        </main>
    );
}
