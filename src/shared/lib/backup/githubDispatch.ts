import { appSetting } from "@/shared/lib/settings/appSettings.server";

/**
 * dotenv strips a trailing `# comment` from .env values, but the Vercel env UI
 * does not — pasting a commented line there stores it verbatim, giving values
 * like "dev   # branch to use". That surfaces as a confusing 404 (bad ref) or
 * 401 (bad token) from GitHub, so strip the comment on our side as well.
 */
export function cleanEnvValue(value: string | undefined): string | undefined {
    return value?.split("#")[0].trim() || undefined;
}

/**
 * Triggers a GitHub Actions `workflow_dispatch` run. Used to run pg_dump /
 * pg_restore on a GitHub runner (which has the Postgres client tools) because
 * Vercel functions don't ship those binaries.
 *
 * Requires (Settings → App Settings, else env): GITHUB_DISPATCH_TOKEN (fine-grained PAT with this repo in its
 * access list and Actions: read+write), GITHUB_REPO ("owner/repo"), and
 * optionally GITHUB_WORKFLOW_REF (branch holding the workflow, defaults to
 * "main"). The branch must exist on the remote — GitHub resolves the ref by
 * name, not by commit, so two branches sharing a commit are not interchangeable.
 */
export async function triggerWorkflow(workflowFile: string, inputs: Record<string, string>): Promise<void> {
    const token = cleanEnvValue(await appSetting("GITHUB_DISPATCH_TOKEN"));
    const repo = cleanEnvValue(await appSetting("GITHUB_REPO"));
    const ref = cleanEnvValue(await appSetting("GITHUB_WORKFLOW_REF")) || "main";
    const workflow = cleanEnvValue(workflowFile);
    if (!token) throw new Error("GITHUB_DISPATCH_TOKEN is not set.");
    if (!repo) throw new Error("GITHUB_REPO is not set (expected 'owner/repo').");

    const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ ref, inputs }),
        },
    );

    // A successful dispatch returns 204 No Content.
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        // GitHub's own messages here are famously unhelpful: a fine-grained PAT
        // that cannot see the repo returns 404 (not 403), and a ref that does not
        // exist returns the same 404. Spell out what to check.
        const hint =
            res.status === 404
                ? ` — check that the PAT lists "${repo}" under Repository access, that branch "${ref}" exists on the remote, and that ${workflow} is on that branch.`
                : res.status === 401
                  ? " — GITHUB_DISPATCH_TOKEN is invalid, expired, or has a stray comment/whitespace in it."
                  : "";
        throw new Error(`GitHub workflow dispatch failed (HTTP ${res.status}): ${text.slice(0, 500)}${hint}`);
    }
}

/**
 * The workflow that owns the backup timetable. Separate from backup.yml on purpose:
 * enabling/disabling acts on a whole workflow, and the manual "Back up now" button
 * dispatches backup.yml — so pointing the switch at that file would stop the button
 * working too.
 */
export const SCHEDULED_BACKUP_WORKFLOW = "backup-scheduled.yml";

/** Shared token/repo resolution, so the callers below cannot drift from triggerWorkflow. */
async function githubConfig(): Promise<{ token: string; repo: string }> {
    const token = cleanEnvValue(await appSetting("GITHUB_DISPATCH_TOKEN"));
    const repo = cleanEnvValue(await appSetting("GITHUB_REPO"));
    if (!token) throw new Error("GITHUB_DISPATCH_TOKEN is not set.");
    if (!repo) throw new Error("GITHUB_REPO is not set (expected 'owner/repo').");
    return { token, repo };
}

function githubHeaders(token: string): HeadersInit {
    return {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
}

/** Same 404-means-anything caveat as triggerWorkflow, so say what to check. */
function githubError(action: string, status: number, body: string, repo: string, workflow: string): Error {
    const hint =
        status === 404
            ? ` — check that the PAT lists "${repo}" under Repository access and that ${workflow} exists on the default branch.`
            : status === 403
              ? " — the PAT needs the Actions permission set to Read and write."
              : status === 401
                ? " — GITHUB_DISPATCH_TOKEN is invalid, expired, or has a stray comment/whitespace in it."
                : "";
    return new Error(`GitHub ${action} failed (HTTP ${status}): ${body.slice(0, 300)}${hint}`);
}

/**
 * Is the scheduled-backup workflow currently allowed to run?
 *
 * GitHub reports "active", or one of the disabled states — disabled_manually (a
 * person or this app switched it off) and disabled_inactivity (60 days without a
 * push, which GitHub does on its own and is the usual reason backups stop quietly).
 * The caller shows the difference, because the fix differs: one is a click, the
 * other is a push.
 */
export async function getScheduledBackupState(): Promise<{ enabled: boolean; state: string }> {
    const { token, repo } = await githubConfig();
    const workflow = SCHEDULED_BACKUP_WORKFLOW;

    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}`, {
        headers: githubHeaders(token),
        // The schedule changes rarely, but a stale answer here would show the wrong
        // switch position, so this is one of the few places worth always asking.
        cache: "no-store",
    });
    if (!res.ok) {
        throw githubError("workflow lookup", res.status, await res.text().catch(() => ""), repo, workflow);
    }

    const json = (await res.json()) as { state?: string };
    const state = json.state ?? "unknown";
    return { enabled: state === "active", state };
}

/** Turn the schedule on or off. Takes effect immediately — no commit, no deploy. */
export async function setScheduledBackupEnabled(enabled: boolean): Promise<void> {
    const { token, repo } = await githubConfig();
    const workflow = SCHEDULED_BACKUP_WORKFLOW;

    const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/${enabled ? "enable" : "disable"}`,
        { method: "PUT", headers: githubHeaders(token) },
    );
    // Success is 204 No Content.
    if (!res.ok) {
        const action = enabled ? "workflow enable" : "workflow disable";
        throw githubError(action, res.status, await res.text().catch(() => ""), repo, workflow);
    }
}


/** Workflow file names — Settings → App Settings, else env, else the default. */
export const backupWorkflowFile = async () => cleanEnvValue(await appSetting("GITHUB_BACKUP_WORKFLOW")) || "backup.yml";
export const restoreWorkflowFile = async () => cleanEnvValue(await appSetting("GITHUB_RESTORE_WORKFLOW")) || "restore.yml";
