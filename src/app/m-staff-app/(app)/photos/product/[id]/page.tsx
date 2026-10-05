import { notFound } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { mobileUser } from "@/modules/mobile/lib/mobileAccess";
import MobileProductPhotos from "@/modules/mobile/components/MobileProductPhotos";

export default async function MobileProductPhotosPage({ params }: { params: Promise<{ id: string }> }) {
    await mobileUser(PERMISSIONS.MOBILE_PHOTOS_EDIT);
    const id = Number((await params).id);
    if (!Number.isInteger(id)) notFound();
    return <MobileProductPhotos id={id} />;
}
