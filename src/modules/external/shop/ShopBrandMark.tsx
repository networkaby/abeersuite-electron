import { Package } from "lucide-react";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { cn } from "@/shared/lib/format/utils";

export default function ShopBrandMark({
    className,
    imageClassName,
}: {
    className?: string;
    imageClassName?: string;
}) {
    if (!COMPANY_DETAILS.logoUrl) {
        return (
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary", className)}>
                <Package className="size-5" />
            </span>
        );
    }

    return (
        <span className={cn("block h-9 w-32 shrink-0 sm:h-10 sm:w-36", className)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local SVG wordmark loads more reliably without Next image processing. */}
            <img
                src={COMPANY_DETAILS.logoUrl}
                alt={COMPANY_DETAILS.brandName}
                className={cn("h-full w-full object-contain", imageClassName)}
            />
        </span>
    );
}
