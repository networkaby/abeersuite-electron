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
    [Parameter(Mandatory = $true)][string] $FirewallRuleName
)

$ErrorActionPreference = 'Continue'

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
