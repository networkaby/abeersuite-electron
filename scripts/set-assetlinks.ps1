# Writes one app's entry into public/.well-known/assetlinks.json, keeping every
# other app's entry. Both Android apps share the file: the staff app
# (phone-app/, Capacitor) and the customer app (shop-app/, TWA). A build script
# that overwrote the whole file would cut the other app off — for the TWA that
# means an address bar over every screen.
#   . "$PSScriptRoot\..\scripts\set-assetlinks.ps1"
#   Set-AssetLink -Package in.networkservice.shop -Apk .\app-release-signed.apk
function Set-AssetLink {
    param(
        [Parameter(Mandatory)] [string] $Package,
        [Parameter(Mandatory)] [string] $Apk
    )
    # The fingerprint is read off the signed APK itself, so the site can never
    # vouch for a different key than the one the phones hold.
    $certs = & "$env:ANDROID_HOME\build-tools\36.1.0\apksigner.bat" verify --print-certs $Apk
    $hex = ($certs | Select-String "SHA-256 digest: ([0-9a-f]{64})").Matches[0].Groups[1].Value
    if (-not $hex) { throw "Could not read the signing fingerprint from $Apk." }
    $fingerprint = (($hex.ToUpper() -split '(..)' | Where-Object { $_ }) -join ':')

    $file = Join-Path $PSScriptRoot "..\public\.well-known\assetlinks.json"
    $existing = @()
    if (Test-Path $file) {
        $existing = @(Get-Content $file -Raw | ConvertFrom-Json) |
            Where-Object { $_.target.package_name -ne $Package }
    }
    $links = @($existing) + @([pscustomobject]@{
        relation = @("delegate_permission/common.handle_all_urls")
        target = [pscustomobject]@{ namespace = "android_app"; package_name = $Package; sha256_cert_fingerprints = @($fingerprint) }
    })
    New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
    ConvertTo-Json -InputObject $links -Depth 5 | Set-Content $file -Encoding utf8NoBOM
}
