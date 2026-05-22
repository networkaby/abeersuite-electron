import { BackupRestorePanel } from "@/modules/settings/components/BackupRestorePanel";

export const metadata = { title: "Backup & Restore" };

export default function BackupRestorePage() {
    return (
        <div className="space-y-6 p-6">
            <div>
                <h1 className="text-xl font-semibold">Backup & Restore</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Download a full Postgres dump of the database to your computer, or restore a previous dump. Restore
                    replaces all current data.
                </p>
            </div>
            <BackupRestorePanel />
        </div>
    );
}
