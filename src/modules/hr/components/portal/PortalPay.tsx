"use client";

// Pay — the slips, the structure they are worked from, the money ledger, and
// the target. The HR tabs render read-only here: what the person may do is
// look, and (on Money) pay when they hold the payroll grant.

import { Target } from "lucide-react";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { Section } from "@/shared/components/StatCard";
import { useApiResource } from "@/shared/hooks";
import type { MyHrPayload } from "../../lib/myHrTypes";
import type { StaffDetail } from "../../lib/staffTypes";
import MyTargetCard, { monthLabel } from "../MyTargetCard";
import StaffMoneyTab from "../StaffMoneyTab";
import StaffPayTab from "../StaffPayTab";
import StaffPayslips from "../StaffPayslips";
import MonthNav from "./MonthNav";
import SubTabs from "./SubTabs";
import { VIEWS, type PortalNav } from "./portalNav";

export default function PortalPay({ userId, me, staff, month, onMonth, nav, canPaySalary }: {
    userId: number;
    me: ReturnType<typeof useApiResource<MyHrPayload>>;
    staff: ReturnType<typeof useApiResource<StaffDetail>>;
    month: string; onMonth: (m: string) => void; nav: PortalNav; canPaySalary: boolean;
}) {
    const view = nav.view ?? "payslips";
    const url = `/api/hr/staff/${userId}`;

    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <SubTabs tabs={VIEWS.pay} active={view} onChange={(v) => nav.go("pay", v)} />
                {view === "target" && <div className="mb-4"><MonthNav month={month} onMonth={onMonth} /></div>}
            </div>

            {view === "payslips" && <StaffPayslips userId={userId} />}

            {view === "salary" && (
                <>
                    <QueryStateBlock loading={staff.loading} error={staff.error} hasData={!!staff.data} onRetry={staff.reload} />
                    {staff.data && <StaffPayTab url={url} detail={staff.data} canEdit={false} onChanged={staff.reload} />}
                </>
            )}

            {view === "money" && (
                <>
                    <QueryStateBlock loading={staff.loading} error={staff.error} hasData={!!staff.data} onRetry={staff.reload} />
                    {staff.data && <StaffMoneyTab detail={staff.data} canPay={canPaySalary} />}
                </>
            )}

            {view === "target" && (
                <>
                    <QueryStateBlock loading={me.loading} error={me.error} hasData={!!me.data} onRetry={me.reload} />
                    {me.data && (
                        <Section title={me.data.isCurrentMonth ? "My target this month" : `My target in ${monthLabel(me.data.month)}`} icon={<Target size={15} />}>
                            <MyTargetCard month={me.data.commission} isCurrentMonth={me.data.isCurrentMonth} />
                        </Section>
                    )}
                </>
            )}
        </div>
    );
}
