# Builds the signed staff-app APK (Capacitor) and puts it where the website serves it.
#   pwsh -File phone-app\build-apk.ps1
#
# Asks for the signing key's passwords — only the owner types those; they live in
# this process's environment for the build and are never written down.
# Rebuild only when the native side changes (name, icon, a new plugin or
# permission): the screens are the live website, so a deploy reaches installed
# phones without a new APK. Bump versionCode in android/app/build.gradle first, or
# phones refuse it as "not an update".
#
# Toolchain on D: (owner, 2026-10-05): JDK 21 (Capacitor 8), Android SDK, Gradle cache.
$ErrorActionPreference = "Stop"
$tools = "D:\AndroidTools"
$env:JAVA_HOME = "$tools\jdk-21.0.12.1+1"
$env:ANDROID_HOME = "$tools\android-sdk"
$env:GRADLE_USER_HOME = "$tools\gradle-home"

Set-Location $PSScriptRoot
if (-not (Test-Path ".\ns-staff.keystore")) {
    throw "phone-app\ns-staff.keystore is missing. Restore it from the backup - a new key cannot update phones that already have the app."
}

if (-not (Test-Path ".\node_modules")) { npm install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw "npm install failed" } }
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw "cap sync failed ($LASTEXITCODE)" }

$store = Read-Host "Password for the key store" -AsSecureString
$key = Read-Host "Password for the key (Enter = same)" -AsSecureString
$env:NS_STAFF_KEYSTORE_PASSWORD = [System.Net.NetworkCredential]::new("", $store).Password
$keyPlain = [System.Net.NetworkCredential]::new("", $key).Password
$env:NS_STAFF_KEY_PASSWORD = if ($keyPlain) { $keyPlain } else { $env:NS_STAFF_KEYSTORE_PASSWORD }

try {
    Push-Location android
    .\gradlew.bat assembleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "gradle build failed ($LASTEXITCODE)" }
} finally {
    Pop-Location
    Remove-Item Env:NS_STAFF_KEYSTORE_PASSWORD, Env:NS_STAFF_KEY_PASSWORD -ErrorAction SilentlyContinue
}

$apk = ".\android\app\build\outputs\apk\release\app-release.apk"
Copy-Item $apk "..\public\ns-staff.apk" -Force

# The fingerprint is read off the signed APK itself, so the site can never vouch
# for a different key than the one the phones hold.
$certs = & "$env:ANDROID_HOME\build-tools\36.1.0\apksigner.bat" verify --print-certs $apk
$hex = ($certs | Select-String "SHA-256 digest: ([0-9a-f]{64})").Matches[0].Groups[1].Value
if (-not $hex) { throw "Could not read the signing fingerprint from the APK." }
$fingerprint = (($hex.ToUpper() -split '(..)' | Where-Object { $_ }) -join ':')
$package = (Get-Content ".\capacitor.config.json" -Raw | ConvertFrom-Json).appId
$links = @(@{
    relation = @("delegate_permission/common.handle_all_urls")
    target = @{ namespace = "android_app"; package_name = $package; sha256_cert_fingerprints = @($fingerprint) }
})
New-Item -ItemType Directory -Force "..\public\.well-known" | Out-Null
ConvertTo-Json -InputObject $links -Depth 5 | Set-Content "..\public\.well-known\assetlinks.json" -Encoding utf8NoBOM
Write-Host "Done: public\ns-staff.apk and public\.well-known\assetlinks.json updated."
