<#
    Undoes counter-setup.ps1 when AbeerSuite is uninstalled: removes the Defender
    exclusions and the inbound firewall rule, so nothing this app asked for is
    left behind on the PC.

    Run elevated by the NSIS uninstaller, and only when there is actually
    something to remove (see installer.nsh -> customUnInstall). Like the setup
    script it never fails the uninstall - a leftover exclusion must not stop
    somebody removing the app.
#>
param(
    [Parameter(Mandatory = $true)][string] $InstallDir,
    [Parameter(Mandatory = $true)][string] $UpdaterCacheDir,
    [Parameter(Mandatory = $true)][string] $FirewallRuleName,
    [switch] $CheckOnly
)

$ErrorActionPreference = 'Continue'

# -CheckOnly answers one question for the uninstaller: is there anything of ours
# left on this PC to take off? Exit 0 means nothing to do - and the uninstaller
# then skips the administrator prompt entirely. Exit 1 means at least one of the
# two is still there. Note the OR: the install side ANDs the same two checks,
# because it must add whatever is missing, while we must remove whatever remains.
if ($CheckOnly) {
    $exclusionLeft = $false
    try {
        $current = (Get-MpPreference -ErrorAction Stop).ExclusionPath
        foreach ($p in @($InstallDir, $UpdaterCacheDir)) {
            if ($current -contains $p) { $exclusionLeft = $true }
        }
    } catch {
        # No Defender on this PC, so no exclusion of ours can be sitting there.
        $exclusionLeft = $false
    }

    & netsh advfirewall firewall show rule name="$FirewallRuleName" | Out-Null
    $ruleLeft = ($LASTEXITCODE -eq 0)

    if ($exclusionLeft -or $ruleLeft) { exit 1 } else { exit 0 }
}

foreach ($path in @($InstallDir, $UpdaterCacheDir)) {
    try {
        Remove-MpPreference -ExclusionPath $path -ErrorAction Stop
        Write-Output "Defender exclusion removed: $path"
    } catch {
        Write-Output "Could not remove Defender exclusion for ${path}: $($_.Exception.Message)"
    }
}

& netsh advfirewall firewall delete rule name="$FirewallRuleName" | Out-Null
Write-Output "Firewall rule '$FirewallRuleName' removed (netsh exit $LASTEXITCODE)."

exit 0
