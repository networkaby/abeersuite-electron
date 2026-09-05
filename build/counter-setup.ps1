<#
    One-time machine setup for an AbeerSuite counter, run elevated by the NSIS
    installer (see installer.nsh -> ensureCounterSetup).

    Two jobs, both of which need administrator rights and neither of which the
    per-user install can do on its own:

      1. Windows Defender exclusions for the program folder and the updater's
         staging folder. This is the single biggest lever on install and update
         time. electron-builder's NSIS unpacks the whole payload into %TEMP% and
         then copies it again into the program folder, so every file is written
         twice, and Defender inspects each write. Excluding these two folders
         removes the second half of that scanning, and also stops Defender
         re-inspecting the embedded PostgreSQL every time the app starts.

      2. The inbound firewall rule. The old installer ran `netsh advfirewall add
         rule` directly from customInstall, which silently did nothing: the
         install is per-user (perMachine: false), netsh needs admin, and the
         return code was never checked. No counter has ever had this rule, so
         Windows asked the cashier itself on first run.

    Written to be safe to run repeatedly, and with a -CheckOnly mode that needs
    no rights at all: installer.nsh runs that first and only asks the counter for
    permission when something is genuinely missing, so a routine update raises no
    prompt. -CheckOnly exits 0 when everything is already in place, 1 otherwise.

    Never fails the install: a counter that cannot get an exclusion still runs
    correctly, just more slowly, and a shop with third-party antivirus has no
    Get-MpPreference at all. Problems are reported on stdout for the install log
    and the exit code stays 0.
#>
param(
    [Parameter(Mandatory = $true)][string] $InstallDir,
    [Parameter(Mandatory = $true)][string] $UpdaterCacheDir,
    [Parameter(Mandatory = $true)][string] $FirewallRuleName,
    [switch] $CheckOnly
)

$ErrorActionPreference = 'Continue'

function Test-FirewallRule {
    & netsh advfirewall firewall show rule name="$FirewallRuleName" | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Test-DefenderExclusions {
    param([string[]] $Paths)

    try {
        $current = (Get-MpPreference -ErrorAction Stop).ExclusionPath
    } catch {
        # No Defender (third-party antivirus, or the service is off). Nothing to
        # add, so report satisfied rather than prompting for rights we cannot use.
        return $true
    }
    foreach ($p in $Paths) {
        if ($current -notcontains $p) { return $false }
    }
    return $true
}

if ($CheckOnly) {
    $ok = (Test-DefenderExclusions -Paths @($InstallDir, $UpdaterCacheDir)) -and (Test-FirewallRule)
    if ($ok) { exit 0 } else { exit 1 }
}

function Add-DefenderExclusion {
    param([string] $Path)

    try {
        $current = (Get-MpPreference -ErrorAction Stop).ExclusionPath
    } catch {
        Write-Output "Defender is not available on this PC - skipping exclusions."
        return $false
    }

    if ($current -contains $Path) {
        Write-Output "Defender already excludes $Path"
        return $true
    }

    try {
        Add-MpPreference -ExclusionPath $Path -ErrorAction Stop
        Write-Output "Defender exclusion added: $Path"
        return $true
    } catch {
        Write-Output "Could not add Defender exclusion for ${Path}: $($_.Exception.Message)"
        return $false
    }
}

# The updater stages the downloaded installer here. It does not exist yet on a
# fresh install, and Add-MpPreference happily takes a path that is not there, but
# creating it keeps the exclusion and the real folder in step.
if (-not (Test-Path -LiteralPath $UpdaterCacheDir)) {
    New-Item -ItemType Directory -Path $UpdaterCacheDir -Force | Out-Null
}

Add-DefenderExclusion -Path $InstallDir       | Out-Null
Add-DefenderExclusion -Path $UpdaterCacheDir  | Out-Null

# netsh rather than New-NetFirewallRule: it exists on every Windows this app
# supports, and it is what the rule was originally written against.
$exe = Join-Path $InstallDir 'AbeerSuite.exe'
if (Test-FirewallRule) {
    Write-Output "Firewall rule '$FirewallRuleName' already present."
} else {
    & netsh advfirewall firewall add rule name="$FirewallRuleName" dir=in action=allow program="$exe" enable=yes profile=any | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Output "Firewall rule '$FirewallRuleName' added for $exe"
    } else {
        Write-Output "Could not add the firewall rule (netsh exit $LASTEXITCODE)."
    }
}

exit 0
