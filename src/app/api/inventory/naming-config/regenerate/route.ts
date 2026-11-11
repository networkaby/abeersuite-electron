import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { regenerateProductNames } from "@/modules/inventory/lib/regenerateNames";

// POST → rebuild every product's stored name from the naming convention now
// (Settings → Naming convention, "Rebuild all names"). For after imports or bulk
// clean-ups; a normal edit already rebuilds its own product. Products with no
// Custom part keep their hand-typed name. Online name and slug are never touched.
export async function POST() {
    const { response } = await requireModuleAccess("inventory");
    if (response) return response;
    try {
        const result = await regenerateProductNames({ all: true });
        return NextResponse.json(result);
    } catch (e) {
        return handleApiError(e, "Could not rebuild names");
    }
}
