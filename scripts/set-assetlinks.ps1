# Writes one app's entry into public/.well-known/assetlinks.json, keeping every
# other app's entry. Both Android apps share the file: the staff app
# (phone-app/) and the customer app (shop-app-native/), both Capacitor. A build
# script that overwrote the whole file would cut the other app off.
#   . "$PSScriptRoot\..\scripts\set-assetlinks.ps1"
#   Set-AssetLink -Package in.networkservice.shop -Apk .\app-release-signed.apk
#
# Play re-signs what it hands out with its own "app signing key", so a
# Play-installed copy carries a different certificate than our APK. Each app
# lists both: our key (read off the APK below) and Play's key (Play Console →
# Test and release → App integrity → App signing). Missing it = Play's
# "deep link may be failing" warning, links open in the browser.
$PlaySigningKeys = @{
    "in.networkservice.shop"  = "F6:50:30:0E:13:EF:56:A8:9A:54:47:74:FB:68:4D:32:9A:2A:09:F4:93:F4:38:99:F1:DF:E0:04:9D:EA:02:1D"
    "in.networkservice.staff" = "18:4C:CF:31:7E:F2:B0:A4:C4:F6:39:1F:2A:FC:51:99:12:82:83:6E:63:35:EA:7A:69:61:28:DF:8E:71:C0:C4"
}

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
        target = [pscustomobject]@{ namespace = "android_app"; package_name = $Package; sha256_cert_fingerprints = @(@($fingerprint, $PlaySigningKeys[$Package]) | Where-Object { $_ }) }
    })
    New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
    ConvertTo-Json -InputObject $links -Depth 5 | Set-Content $file -Encoding utf8NoBOM
}
