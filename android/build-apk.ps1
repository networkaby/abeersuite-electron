# Builds the signed staff-app APK and puts it where the website serves it.
#   pwsh -File android\build-apk.ps1      (PowerShell 7 — the utf8NoBOM write needs it)
#
# Run it by hand: Bubblewrap asks for the signing key's passwords, and only the owner
# types those. Rebuild only when the app's name, icon, colours or address change —
# the screens are the website, so a deploy reaches installed phones without a new APK.
# A rebuild must bump appVersionCode in twa-manifest.json (or `bubblewrap update`
# without --skipVersionUpgrade), or phones refuse it as "not an update".
#
# Toolchain lives on D: (owner, 2026-10-05). ~/.bubblewrap/config.json points at the
# same JDK and SDK; Gradle's cache is kept here too instead of C:\Users\...\.gradle.
$ErrorActionPreference = "Stop"
$tools = "D:\AndroidTools"
$env:JAVA_HOME = "$tools\jdk-17.0.20.1+1"
$env:ANDROID_HOME = "$tools\android-sdk"
$env:GRADLE_USER_HOME = "$tools\gradle-home"

Set-Location $PSScriptRoot
# Bubblewrap runs a bare `gradlew.bat` through cmd; PowerShell 7 sets
# NoDefaultCurrentDirectoryInExePath, so cmd won't look in this folder unless told.
$env:PATH = "$PSScriptRoot;$env:PATH"
if (-not (Test-Path ".\ns-staff.keystore")) {
    throw "android\ns-staff.keystore is missing. Restore it from the backup - a new key cannot update phones that already have the app."
}

& "$tools\bubblewrap\node_modules\.bin\bubblewrap.cmd" build --skipPwaValidation
if ($LASTEXITCODE -ne 0) { throw "bubblewrap build failed ($LASTEXITCODE)" }

# The APK is served from public/ (PHONE_APP_APK in src/shared/lib/device/phone.ts);
# assetlinks.json is what lets the app open full screen with no address bar.
Copy-Item ".\app-release-signed.apk" "..\public\ns-staff.apk" -Force

# The fingerprint is read off the signed APK itself (no password needed), so the
# site can never vouch for a different key than the one the phones hold.
$certs = & "$env:ANDROID_HOME\build-tools\36.1.0\apksigner.bat" verify --print-certs ".\app-release-signed.apk"
$hex = ($certs | Select-String "SHA-256 digest: ([0-9a-f]{64})").Matches[0].Groups[1].Value
if (-not $hex) { throw "Could not read the signing fingerprint from the APK." }
$fingerprint = (($hex.ToUpper() -split '(..)' | Where-Object { $_ }) -join ':')
$package = (Get-Content ".\twa-manifest.json" -Raw | ConvertFrom-Json).packageId
$links = @(@{
    relation = @("delegate_permission/common.handle_all_urls")
    target = @{ namespace = "android_app"; package_name = $package; sha256_cert_fingerprints = @($fingerprint) }
})
New-Item -ItemType Directory -Force "..\public\.well-known" | Out-Null
ConvertTo-Json -InputObject $links -Depth 5 | Set-Content "..\public\.well-known\assetlinks.json" -Encoding utf8NoBOM
Write-Host "Done: public\ns-staff.apk and public\.well-known\assetlinks.json updated."
