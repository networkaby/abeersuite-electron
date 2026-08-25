/**
 * Can this machine run a backup or a restore at all?
 *
 * Neither operation happens here. The app only dispatches a GitHub Actions run (the one
 * place `pg_dump`/`pg_restore` exist) and lists the dumps in Dropbox for the restore
 * picker — so "can we?" is a pure configuration question, answerable before any network
 * call.
 *
 * A counter build may legitimately ship without these keys: `scripts/counterEnv.ts` copies
 * them only if the build machine has them, and names the ones it skipped. Without this
 * check that absence reached the shop floor as `DROPBOX_APP_KEY is not set.` in a red toast
 * — a developer's error message, on a page that looked fully working, shown to a staff
 * member who cannot act on a key name.
 *
 * Presence only. Values are never read here, and only KEY names are ever returned.
 */
import { cleanEnvValue } from "@/shared/lib/backup/githubDispatch";

/** What `triggerWorkflow` needs. `GITHUB_WORKFLOW_REF` is optional — it defaults to "main". */
const GITHUB_KEYS = ["GITHUB_DISPATCH_TOKEN", "GITHUB_REPO"];

/** What `getDropboxAccessToken` needs. `DROPBOX_FOLDER` is optional — it defaults to the app-folder root. */
const DROPBOX_KEYS = ["DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "DROPBOX_REFRESH_TOKEN"];

export interface BackupAvailability {
    /** Backup needs GitHub only — the runner uploads to Dropbox with the repo's own secrets. */
    canBackup: boolean;
    /** Restore also needs Dropbox, because the user picks from the dumps this app lists. */
    canRestore: boolean;
    /** KEY names not configured here, so a Role-Admin can name them to whoever builds the installer. */
    missing: string[];
}

/** Sent to staff in place of "<KEY> is not set." — a key name tells them nothing they can use. */
export const COUNTER_ONLY_MESSAGE =
    "Counter-only machine — backup and restore are not available here. Use the office app.";

export function backupAvailability(): BackupAvailability {
    // GitHub values go through `cleanEnvValue` because `triggerWorkflow` does: a value pasted
    // into the Vercel env UI with a trailing "# comment" is present but unusable, and has to
    // count as missing here too — otherwise this reports "available" and the dispatch 401s.
    const missingGithub = GITHUB_KEYS.filter((key) => !cleanEnvValue(process.env[key]));
    const missingDropbox = DROPBOX_KEYS.filter((key) => !process.env[key]?.trim());
    const hasGithub = missingGithub.length === 0;

    return {
        canBackup: hasGithub,
        canRestore: hasGithub && missingDropbox.length === 0,
        missing: [...missingGithub, ...missingDropbox],
    };
}
