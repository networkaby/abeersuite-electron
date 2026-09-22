import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireStaffPage } from "@/shared/lib/auth/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import { resolveTemplateForFormat } from "@/shared/lib/print/voucherTemplateDefaults";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { PayslipBody, type PayslipAttendanceData, type PayslipBodyData, type PayslipCommissionData } from "@/shared/components/print/PayslipBody";
import { parseSalaryLines } from "@/modules/hr/lib/salaryLines";
import { formatPeriod } from "@/modules/hr/lib/payrollTypes";

// Salary slip print page — one PayrollRunLine through the PAYSLIP print template.
//
// The same gate as /api/hr/staff/[userId]/payslips: the person themselves, or
// anyone holding hr:staff:edit. Only a line on a POSTED run is a slip — a draft
// has not happened and a cancelled run has been taken back out of the books —
// so anything else is simply not found.
export default async function PayslipPage({
    params,
    searchParams,
}: {
    params:        Promise<{ lineId: string }>;
    searchParams?: Promise<{ paper?: string; autoprint?: string }>;
}) {
    await requireStaffPage();
    const session = await auth();
    const me = session?.user as { id?: string | number; permissions?: string[] } | undefined;
    if (!me?.id) redirect("/staff/login");

    const lineId = Number((await params).lineId);
    if (!Number.isInteger(lineId) || lineId <= 0) notFound();
    const sp = (await searchParams) ?? {};

    const line = await prisma.payrollRunLine.findUnique({
        where: { id: lineId },
        select: {
            id: true, userId: true, staffName: true, linesJson: true, attendanceJson: true, commissionJson: true,
            grossPaise: true, deductionsPaise: true, netPaise: true,
            paidDays: true, periodDays: true, payDays: true, included: true,
            run: { select: { status: true, periodFrom: true, periodTo: true, postingDate: true, voucherRef: true } },
        },
    });
    if (!line || !line.included || line.run.status !== "POSTED") notFound();

    const isSelf = Number(me.id) === line.userId;
    const isHr = hasPermissionWithScope(me.permissions ?? [], PERMISSIONS.HR_STAFF_EDIT);
    if (!isSelf && !isHr) redirect("/office");

    const person = await prisma.user.findUnique({
        where: { id: line.userId },
        select: {
            staffProfile: { select: { staffCode: true, joinedOn: true } },
            userPositions: { take: 1, orderBy: { createdAt: "asc" }, select: { position: { select: { title: true } } } },
        },
    });

    const template = await getVoucherTemplate("PAYSLIP");
    const format = resolvePaperFormat(template, sp.paper);
    const isThermal = format === "THERMAL_80MM";

    const periodFrom = toDateOnlyUtc(line.run.periodFrom);
    const periodTo = toDateOnlyUtc(line.run.periodTo);
    const bodyData: PayslipBodyData = {
        slipNo:      `PS-${line.id}`,
        staffName:   line.staffName,
        staffCode:   person?.staffProfile?.staffCode ?? null,
        designation: person?.userPositions[0]?.position.title ?? null,
        joinedOn:    person?.staffProfile?.joinedOn ? toDateOnlyUtc(person.staffProfile.joinedOn) : null,
        periodFrom, periodTo,
        postingDate: toDateOnlyUtc(line.run.postingDate),
        voucherRef:  line.run.voucherRef,
        paidDays:    line.paidDays,
        periodDays:  line.periodDays,
        payDays:     line.payDays,
        lines:       parseSalaryLines(line.linesJson),
        grossPaise:  line.grossPaise,
        deductionsPaise: line.deductionsPaise,
        netPaise:    line.netPaise,
        // Frozen at generation; a line from before that carries null and the
        // slip prints without the section rather than reading the register now.
        attendance:  (line.attendanceJson as unknown as PayslipAttendanceData | null) ?? null,
        commission:  (line.commissionJson as unknown as PayslipCommissionData | null) ?? null,
    };
    const flags = resolveTemplateForFormat(template, format);

    // The chrome's own meta row: slip number and the posting date.
    const sample: ThermalReceiptSample = {
        reference:  bodyData.slipNo,
        date:       bodyData.postingDate,
        partyName:  line.staffName,
        partyPhone: null,
        lines: [], subtotal: null, taxAmount: null, total: null, notes: null,
    };
    const title = `Salary slip ${bodyData.slipNo} · ${line.staffName} · ${formatPeriod(periodFrom, periodTo)}`;

    return (
        <ReceiptPreview
            format={format}
            template={template}
            sample={sample}
            body={<PayslipBody data={bodyData} thermal={isThermal} showAttendance={flags.showAttendance} showCommission={flags.showCommission} />}
            // Browser print only: the hardware bridge's thermal renderer has no
            // salary-slip middle, and a slip is an A4 document by default anyway.
            toolbar={<PrintToolbar autoPrint={sp.autoprint === "1"} showFormatPicker currentPaper={format} />}
            docTitle={title}
        />
    );
}
