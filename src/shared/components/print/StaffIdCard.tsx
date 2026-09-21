// Staff identity card — the shop's own employee ID, at the exact PAN / credit
// card size (ID-1: 85.6 × 54 mm), front and back.
//
// Deliberately NOT a print-template kind. Owner, 2026-09-20: the card is shown
// as a live preview on the person's own profile and on the HR staff profile,
// so what you see is what prints — there is nothing to configure behind it.
// The shop's identity comes straight from COMPANY_DETAILS via getOrganisation(),
// the same source every other printed document falls back to.
//
// Its layout is its own (house rule: print formats never share layout code).
// The tab preview, the enlarge dialog and the print sheet all render THIS
// component, so none of the three can drift from the paper. The PVC press
// artwork at `/api/hr/staff/[userId]/id-card-image` is the one exception and is
// drawn separately, because Satori cannot read this stylesheet; it is written
// in the same millimetres so the two stay one design.

import { getOrganisation } from "@/shared/lib/org/getOrganisation";

export interface StaffIdCardData {
    name: string;
    designation: string | null;
    photoUrl: string | null;
    staffCode: string | null;
    joinedOn: string | null;          // already formatted for reading
    phone: string | null;
    bloodGroup: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
    address: string | null;
}

const SCOPE = "staff-id-card";

// Real millimetres — the card must come off the printer at bank-card size, so
// every dimension here is mm and nothing is in px or rem.
const CARD_W = "85.6mm";
const CARD_H = "54mm";

function initials(name: string) {
    return name.trim().split(/\s+/).slice(0, 2).map((w) => (w[0] ?? "").toUpperCase()).join("");
}

export function staffIdCardCss(scope: string) {
    return `
${scope} { display: flex; flex-wrap: wrap; gap: 6mm; font-family: Arial, 'Helvetica Neue', sans-serif; color: #0f172a; }
/* The card is a coloured object, not a page decoration. Without this a browser
   drops every background when printing: the blue strip went white on paper and
   the white lettering on it disappeared, so the printed card looked nothing
   like the two previews of it. */
${scope}, ${scope} * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
${scope} .card {
    width: ${CARD_W}; height: ${CARD_H}; box-sizing: border-box;
    border: 0.3mm solid #cbd5e1; border-radius: 3mm; overflow: hidden;
    background: #fff; position: relative; display: flex; flex-direction: column;
}
${scope} .strip { background: linear-gradient(135deg,#1d4ed8 0%,#3b82f6 100%); color: #fff;
    padding: 2mm 3mm; display: flex; align-items: center; gap: 2.4mm; }
/* The wordmark is a single blue colour on a transparent ground, so straight on
   the blue strip it was all but invisible. It sits on a white chip instead —
   the same treatment the staff sign-in page gives it over its dark panel. */
${scope} .mark { background: #fff; border-radius: 1.2mm; padding: 0.9mm 1.4mm; flex: none;
    display: flex; align-items: center; }
${scope} .mark img { height: 3.6mm; width: auto; display: block; object-fit: contain; }
${scope} .brand { font-size: 3.1mm; font-weight: 700; letter-spacing: 0.15mm; line-height: 1.1; }
${scope} .tag { font-size: 2.1mm; opacity: 0.9; line-height: 1.2; min-width: 0; }
${scope} .face { flex: 1; display: flex; gap: 3mm; padding: 2.6mm 3mm; min-height: 0; }
${scope} .photo { width: 19mm; height: 24mm; flex: none; border: 0.25mm solid #cbd5e1; border-radius: 1.2mm;
    overflow: hidden; background: #f1f5f9; display: flex; align-items: center; justify-content: center; }
${scope} .photo img { width: 100%; height: 100%; object-fit: cover; }
${scope} .photo .ini { font-size: 7mm; font-weight: 700; color: #94a3b8; }
${scope} .who { min-width: 0; flex: 1; display: flex; flex-direction: column; }
${scope} .name { font-size: 4mm; font-weight: 700; line-height: 1.15; }
${scope} .desig { font-size: 2.7mm; color: #1d4ed8; font-weight: 600; margin-top: 0.4mm; }
${scope} .rows { margin-top: 1.4mm; display: grid; grid-template-columns: auto 1fr; gap: 0.5mm 2mm; align-items: baseline; }
${scope} .k { font-size: 2.2mm; color: #64748b; text-transform: uppercase; letter-spacing: 0.1mm; }
${scope} .v { font-size: 2.5mm; font-weight: 600; }
${scope} .foot { border-top: 0.25mm solid #e2e8f0; padding: 1.2mm 3mm; font-size: 2.1mm; color: #64748b;
    display: flex; justify-content: space-between; gap: 2mm; }
${scope} .back { flex: 1; padding: 2.8mm 3.4mm; display: flex; flex-direction: column; gap: 1.4mm;
    font-size: 2.4mm; line-height: 1.35; }
${scope} .back .h { font-size: 2.2mm; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15mm; color: #1d4ed8; }
${scope} .back p { margin: 0; }
${scope} .sign { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; gap: 3mm; }
${scope} .sign .line { border-top: 0.25mm solid #94a3b8; padding-top: 0.6mm; font-size: 2.1mm;
    color: #64748b; min-width: 26mm; text-align: center; }
${scope} .lost { font-size: 2.1mm; color: #475569; }
`;
}

/** Front of the card — photo, name, designation, staff code. */
export function StaffIdCardFront({ data }: { data: StaffIdCardData }) {
    const org = getOrganisation();
    return (
        <div className="card">
            <div className="strip">
                {/* The wordmark already reads as the brand name, so it carries it in
                    `alt` and the name is not set again in text beside it — the same
                    rule the sign-in pages follow. Without a logo on file the name
                    is spelled out instead, so the card is never unbranded. */}
                {org.logoUrl ? (
                    <span className="mark">
                        {/* eslint-disable-next-line @next/next/no-img-element -- print document */}
                        <img src={org.logoUrl} alt={org.brandName} />
                    </span>
                ) : (
                    <div className="brand">{org.brandName}</div>
                )}
                {org.tagline && <div className="tag">{org.tagline}</div>}
            </div>
            <div className="face">
                <div className="photo">
                    {data.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- print document
                        <img src={data.photoUrl} alt={data.name} />
                    ) : (
                        <span className="ini">{initials(data.name)}</span>
                    )}
                </div>
                <div className="who">
                    <div className="name">{data.name}</div>
                    {data.designation && <div className="desig">{data.designation}</div>}
                    <div className="rows">
                        {data.staffCode && (<><span className="k">ID</span><span className="v">{data.staffCode}</span></>)}
                        {data.joinedOn && (<><span className="k">Joined</span><span className="v">{data.joinedOn}</span></>)}
                        {data.phone && (<><span className="k">Phone</span><span className="v">{data.phone}</span></>)}
                        {data.bloodGroup && (<><span className="k">Blood</span><span className="v">{data.bloodGroup}</span></>)}
                    </div>
                </div>
            </div>
            <div className="foot">
                <span>{org.phone}</span>
                <span>{org.siteUrl}</span>
            </div>
        </div>
    );
}

/** Back of the card — emergency contact, address, return-if-found, signatures. */
export function StaffIdCardBack({ data }: { data: StaffIdCardData }) {
    const org = getOrganisation();
    const orgAddress = [org.addressLine1, org.addressLine2, `${org.city} ${org.pinCode}`.trim(), org.state]
        .filter(Boolean).join(", ");
    return (
        <div className="card">
            <div className="back">
                {(data.emergencyName || data.emergencyPhone) && (
                    <div>
                        <div className="h">In an emergency, call</div>
                        <p>{[data.emergencyName, data.emergencyPhone].filter(Boolean).join(" — ")}</p>
                    </div>
                )}
                {data.address && (
                    <div>
                        <div className="h">Address</div>
                        <p>{data.address}</p>
                    </div>
                )}
                <p className="lost">
                    This card is the property of {org.legalName || org.brandName}. If found, please return it to{" "}
                    {orgAddress}{org.phone ? ` (${org.phone})` : ""}.
                </p>
                <div className="sign">
                    <span className="line">Holder&apos;s signature</span>
                    <span className="line">Authorised signatory</span>
                </div>
            </div>
        </div>
    );
}

/** Front and back side by side — what both the preview and the sheet show. */
export default function StaffIdCard({ data }: { data: StaffIdCardData }) {
    return (
        <div className={SCOPE}>
            <style>{staffIdCardCss(`.${SCOPE}`)}</style>
            <StaffIdCardFront data={data} />
            <StaffIdCardBack data={data} />
        </div>
    );
}
