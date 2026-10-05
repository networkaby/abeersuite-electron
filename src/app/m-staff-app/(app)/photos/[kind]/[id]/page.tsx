import { notFound } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { mobileUser } from "@/modules/mobile/lib/mobileAccess";
import { isMasterPhotoKind } from "@/modules/mobile/lib/shopPhotos";
import MobileMasterPhoto from "@/modules/mobile/components/MobileMasterPhoto";

// A brand, group or category; a product has its own page (`photos/product/[id]`),
// which Next prefers over this one for the static segment.
export default async function MobileMasterPhotoPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
    await mobileUser(PERMISSIONS.MOBILE_PHOTOS_EDIT);
    const { kind, id: rawId } = await params;
    const id = Number(rawId);
    if (!isMasterPhotoKind(kind) || !Number.isInteger(id)) notFound();
    return <MobileMasterPhoto kind={kind} id={id} />;
}
