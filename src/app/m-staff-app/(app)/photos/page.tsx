import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { mobileUser } from "@/modules/mobile/lib/mobileAccess";
import { PHOTO_KINDS, type PhotoKind } from "@/modules/mobile/lib/shopPhotos";
import MobilePhotos from "@/modules/mobile/components/MobilePhotos";

export default async function MobilePhotosPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
    await mobileUser(PERMISSIONS.MOBILE_PHOTOS_EDIT);
    const { kind } = await searchParams;
    const initialKind: PhotoKind = (PHOTO_KINDS as readonly string[]).includes(kind ?? "") ? (kind as PhotoKind) : "product";
    return <MobilePhotos initialKind={initialKind} />;
}
