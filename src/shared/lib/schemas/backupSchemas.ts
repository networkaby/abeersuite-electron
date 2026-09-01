import { z } from "zod";

// BackupConfig (singleton) — the automatic-backup schedule. `lastRunAt` is written by
// the tick and is intentionally NOT editable through the API.
//
// Both lists are non-empty on purpose. An empty list is indistinguishable from a
// mis-save and silently stops backups, which is the one failure this feature must not
// have: turning backups off should take the switch, deliberately.
export const backupConfigUpdateSchema = z.object({
    enabled: z.boolean().optional(),
    // 0 = Sunday .. 6 = Saturday, IST.
    weekdays: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day.").max(7).optional(),
    // Hours 0-23, IST. The tick is hourly, so this is the finest granularity available.
    hours: z.array(z.number().int().min(0).max(23)).min(1, "Pick at least one time.").max(24).optional(),
});

export type BackupConfigUpdateInput = z.infer<typeof backupConfigUpdateSchema>;
