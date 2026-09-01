import { z } from "zod";

// BackupConfig (singleton) — the scheduled-backup settings edited from
// Settings → Backup & Restore. `lastRunAt` is written by the cron route on a
// successful dispatch and is intentionally NOT editable through the API.
export const backupConfigUpdateSchema = z
    .object({
        enabled:   z.boolean().optional(),
        frequency: z.enum(["daily", "weekly"]).optional(),
        hourUtc:   z.number().int().min(0).max(23).optional(),
        minuteUtc: z.number().int().min(0).max(59).optional(),
        // 0 = Sunday .. 6 = Saturday.
        weekday:   z.number().int().min(0).max(6).nullable().optional(),
    })
    // A weekly schedule with no weekday would never match a tick, leaving backups
    // silently switched off. Catch it here rather than at 2am.
    .refine((v) => v.frequency !== "weekly" || v.weekday != null, {
        message: "Pick a day of the week for a weekly backup.",
        path: ["weekday"],
    });

export type BackupConfigUpdateInput = z.infer<typeof backupConfigUpdateSchema>;
