/**
 * The Administration work board rides the seeded internal-management pipeline.
 * Seeded with a fixed id (not looked up by name like the other pipelines), so the
 * id itself is the constant. Single source — the board page, the task routes and
 * the sidebar count registry all read it from here.
 */
export const ADMIN_TASKS_PIPELINE_ID = "P4" as const;
