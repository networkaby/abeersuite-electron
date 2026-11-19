import "server-only";
import { backupWorkflowFile, triggerWorkflow } from "@/shared/lib/backup/githubDispatch";
import { makeBackupFileName } from "@/shared/lib/backup/dropbox";
import { projectRefFromDbUrl } from "@/shared/lib/backup/dbUrl";
import { primaryAndStaging } from "@/shared/lib/db/dbPrimary";
import { markCopyFinished, markCopyStarted } from "@/shared/lib/db/dbSwitch.server";

/**
 * Dispatch one backup run that dumps the primary to Dropbox and, with two databases,
 * restores the dump into the standby (backup.yml `standby_db`). Shared by the nightly
 * cron and the "Copy into standby now" button, so both start a copy the same way:
 * "copy started" on the primary's `_db_switch` row first, "failed" if the dispatch
 * itself fails. The run reports the finish to /api/cron/db-copied.
 *
 * Addresses never leave: the workflow gets LABELS (DB1 / DB2) and picks its own secret,
 * and refuses to copy into a database that is not read-only.
 */
export async function dispatchBackupWithCopy(opts: {
    source: "cron" | "manual";
    domain: string;
}): Promise<{ fileName: string; copyInto: string | null }> {
    const { primary, staging } = await primaryAndStaging();
    const fileName = makeBackupFileName({
        domain: opts.domain,
        projectRef: projectRefFromDbUrl(primary.direct),
        source: opts.source,
    });
    const inputs: Record<string, string> = {
        source: opts.source,
        domain: opts.domain,
        source_db: primary.id,
        file_name: fileName,
    };

    if (staging) {
        inputs.standby_db = staging.id;
        await markCopyStarted(staging.id, fileName);
    }

    try {
        await triggerWorkflow(await backupWorkflowFile(), inputs);
    } catch (err) {
        if (staging) await markCopyFinished(staging.id, false).catch(() => {});
        throw err;
    }
    return { fileName, copyInto: staging?.id ?? null };
}
