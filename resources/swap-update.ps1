<#
    Swaps an already-unpacked update into place, then starts the app again.

    This is the only part of a staged update that runs with the counter down, and it is
    deliberately the cheapest part: two renames. Everything expensive — pulling the
    payload out of the installer and expanding 627 MB of it — has already happened in
    electron/stagedUpdate.ts while the till was still selling.

    It cannot run inside the app, because the folder being renamed is the one the running
    executable lives in. So the app starts this detached, hands over both folder names and
    its own process id, and quits.

    ── The rule this file is written around ─────────────────────────────────────
    A counter must come back up. Every failure below either rolls the old folder back or
    leaves it exactly where it was, and then starts the app from whatever is in place. A
    counter running last week's version is a nuisance; a counter that does not start is a
    shop that cannot bill.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][int]    $WaitForPid,
    [Parameter(Mandatory = $true)][string] $InstallDir,
    [Parameter(Mandatory = $true)][string] $StagedDir,
    [Parameter(Mandatory = $true)][string] $Version
)

$ErrorActionPreference = 'Stop'

$parent  = Split-Path -Parent $InstallDir
$exeName = 'AbeerSuite.exe'
$appExe  = Join-Path $InstallDir $exeName
$oldDir  = Join-Path $parent (".AbeerSuite-old-{0}" -f (Get-Date -Format 'yyyyMMddHHmmss'))
$marker  = Join-Path $parent (".AbeerSuite-staged-{0}.json" -f $Version)
$log     = Join-Path $env:TEMP 'abeersuite-swap-update.log'

function Write-Log([string] $Message) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    try { Add-Content -LiteralPath $log -Value $line -ErrorAction Stop } catch { }
}

# Starting the app is the last thing that happens on every path through this script,
# including the failure paths — hence a function rather than a line at the bottom.
function Start-App {
    try {
        if (Test-Path -LiteralPath $appExe) {
            Start-Process -FilePath $appExe -WorkingDirectory $InstallDir | Out-Null
            Write-Log "Started $appExe"
        }
        else {
            Write-Log "FATAL: $appExe is not there; nothing to start."
        }
    }
    catch {
        Write-Log "Could not start the app: $_"
    }
}

Write-Log "--- swap $Version : pid=$WaitForPid install=$InstallDir staged=$StagedDir"

# ── 1. Wait for the app to go ────────────────────────────────────────────────
# will-quit in electron/main.ts stops the Next server, the sync worker, the hardware
# bridge and the embedded PostgreSQL before the process ends, so waiting on this one pid
# covers the children too.
try {
    $proc = Get-Process -Id $WaitForPid -ErrorAction SilentlyContinue
    if ($proc) { $proc.WaitForExit(120000) | Out-Null }
}
catch { Write-Log "Wait on pid $WaitForPid ended early: $_" }

# ── 2. Wait for anything still holding files open in the program folder ──────
# postgres.exe is the one that matters: it is stopped with `pg_ctl stop -m fast`, which
# returns before the server has finished closing its files. A rename attempted while a
# handle is open fails, and on Windows it fails for the whole folder.
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    $holders = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) })
    if ($holders.Count -eq 0) { break }
    Write-Log ("Waiting for {0} process(es) under the program folder: {1}" -f $holders.Count, (($holders | ForEach-Object { $_.Name }) -join ', '))
    Start-Sleep -Milliseconds 500
}

# ── 3. Carry over what the payload does not contain ─────────────────────────
# `Uninstall AbeerSuite.exe` is written by NSIS at install time and lives outside
# app-64.7z, so the staged folder has no copy of it. Losing it would leave the counter
# with no way to uninstall and a broken Add/Remove Programs entry.
try {
    $uninstaller = Join-Path $InstallDir 'Uninstall AbeerSuite.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        Copy-Item -LiteralPath $uninstaller -Destination (Join-Path $StagedDir 'Uninstall AbeerSuite.exe') -Force
        Write-Log 'Carried the uninstaller across.'
    }
}
catch { Write-Log "Could not carry the uninstaller across: $_" }

# ── 4. The swap ─────────────────────────────────────────────────────────────
# Two renames on one volume. Neither copies a byte, so the counter is down for the time
# the filesystem takes to move two directory entries.
if (-not (Test-Path -LiteralPath (Join-Path $StagedDir $exeName))) {
    Write-Log "Staged folder has no $exeName — leaving the counter on the version it has."
    Start-App
    exit 1
}

try {
    Rename-Item -LiteralPath $InstallDir -NewName (Split-Path -Leaf $oldDir) -ErrorAction Stop
    Write-Log "Moved the old version aside to $oldDir"
}
catch {
    # Nothing has moved. The old version is untouched and still bootable.
    Write-Log "Could not move the old version aside: $_"
    Start-App
    exit 1
}

try {
    Rename-Item -LiteralPath $StagedDir -NewName (Split-Path -Leaf $InstallDir) -ErrorAction Stop
    Write-Log "Swapped $Version into place."
}
catch {
    # The dangerous moment: the program folder does not exist under its own name. Put the
    # old one back before doing anything else.
    Write-Log "Could not move the new version in: $_ — rolling back."
    try {
        Rename-Item -LiteralPath $oldDir -NewName (Split-Path -Leaf $InstallDir) -ErrorAction Stop
        Write-Log 'Rolled back to the previous version.'
    }
    catch {
        Write-Log "ROLLBACK FAILED: $_"
    }
    Start-App
    exit 1
}

# ── 5. Back up and running ──────────────────────────────────────────────────
# Before the tidy-up, because the shop waiting to bill matters more than 600 MB.
Start-App

# ── 6. Tell Add/Remove Programs what version is actually installed ──────────
# NSIS owns this key normally. A staged swap never runs NSIS, so without this the entry
# keeps naming the version that was replaced.
try {
    $roots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {
            $props = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
            if ($props.DisplayName -eq 'AbeerSuite') {
                Set-ItemProperty -LiteralPath $_.PSPath -Name 'DisplayVersion' -Value $Version -ErrorAction SilentlyContinue
                Write-Log "Updated DisplayVersion on $($_.PSPath)"
            }
        }
    }
}
catch { Write-Log "Could not update the uninstall entry (cosmetic): $_" }

# ── 7. Recreate desktop shortcut with the updated icon ──────────────────────
# Critical for seasonal / festive event icon updates so Windows Explorer
# refreshes and displays the new icon on the desktop immediately.
try {
    $desktopPath = [Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktopPath 'AbeerSuite.lnk'
    $commonDesktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
    $commonShortcut = Join-Path $commonDesktop 'AbeerSuite.lnk'

    # If installed per-user, remove any stale Public Desktop link
    if ($InstallDir.StartsWith($env:LOCALAPPDATA, [StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $commonShortcut) {
            Remove-Item -LiteralPath $commonShortcut -Force -ErrorAction SilentlyContinue
            Write-Log "Removed stale public desktop shortcut: $commonShortcut"
        }
    }

    # Recreate the desktop shortcut pointing to index 0 of the new executable
    $wsh = New-Object -ComObject WScript.Shell
    $shortcut = $wsh.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $appExe
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.IconLocation = "$appExe,0"
    $shortcut.Description = "AbeerSuite Desktop Operating System"
    $shortcut.Save()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($wsh) | Out-Null
    Write-Log "Recreated desktop shortcut with new icon: $shortcutPath"
}
catch { Write-Log "Could not refresh desktop shortcut: $_" }

# ── 8. Tidy up ──────────────────────────────────────────────────────────────
# Best effort only. Whatever survives here is cleared on the next boot by
# repairAfterSwap() in electron/stagedUpdate.ts, on a counter already known to be running.
try { Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue } catch { }
try {
    Remove-Item -LiteralPath $oldDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Log 'Removed the old version.'
}
catch { Write-Log "Old version left for the next boot to clear: $_" }

Write-Log "--- swap $Version done"
