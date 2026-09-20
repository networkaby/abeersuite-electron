import { notFound } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireStaffPage } from "@/shared/lib/auth/permissions";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import SetDocumentTitle from "@/shared/components/print/SetDocumentTitle";
import StaffIdCard from "@/shared/components/print/StaffIdCard";
import { STAFF_USER_SELECT, shapeStaffUser } from "@/shared/lib/users/staffSelect";
import { STAFF_PROFILE_INCLUDE, toStaffProfileDto } from "@/modules/hr/lib/staffProfileServer";
import { toStaffIdCardData } from "@/modules/hr/lib/staffIdCard";

// The staff identity card on paper — front and back at the true PAN / credit
// card size (85.6 × 54 mm), side by side on A4 with a cut line, so the rest of
// the sheet is reused. Opened from the "ID Card" tab on either the person's own
// profile or their HR profile; both show the very same card on screen first.
//
// No print template behind it (owner's call, 2026-09-20) — the shop's brand,
// address and phone come from COMPANY_DETAILS, like every other document's
// fallback. Browser print only: a card is never a counter slip, so there is no
// thermal way and no format picker.

export default async function StaffIdCardPrintPage({
    params,
    searchParams,
}: {
    params: Promise<{ userId: string }>;
    searchParams?: Promise<{ autoprint?: string }>;
}) {
    await requireStaffPage();

    const { userId } = await params;
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) notFound();

    const sp = (await searchParams) ?? {};

    const user = await prisma.user.findUnique({
        where: { id },
        select: { ...STAFF_USER_SELECT, staffProfile: { include: STAFF_PROFILE_INCLUDE } },
    });
    if (!user) notFound();

    const shaped = shapeStaffUser(user);
    const data = toStaffIdCardData({
        user: {
            id: shaped.id, name: shaped.name, email: shaped.email, title: shaped.title,
            role: shaped.role, avatarUrl: shaped.avatarUrl, phone: shaped.phone,
            positions: shaped.positions, scope: shaped.scope, managerId: shaped.managerId,
            manager: shaped.manager, userRole: shaped.userRole,
        },
        profile: user.staffProfile ? toStaffProfileDto(user.staffProfile) : null,
    });

    return (
        <>
            <SetDocumentTitle title={`ID Card — ${shaped.name}`} />
            <style>{`
          @page { size: A4; margin: 12mm; }
          body { background: #f1f5f9; margin: 0; }
          .sheet { padding: 10mm 12mm; }
          /* Cut line — snip the strip off and keep the rest of the sheet. */
          .cut { margin-top: 8mm; border-top: 0.3mm dashed #94a3b8; padding-top: 2mm;
                 font-family: Arial, sans-serif; font-size: 3mm; color: #64748b; }
          @media print {
            body { background: #fff; }
            .sheet { padding: 0; }
            .no-print { display: none !important; }
          }
        `}</style>
            <PrintToolbar autoPrint={sp.autoprint !== "0"} />
            <div className="sheet">
                <StaffIdCard data={data} />
                <div className="cut">✂ Cut along this line — each card is 85.6 × 54 mm, front and back.</div>
            </div>
        </>
    );
}
