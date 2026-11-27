# Builds the signed staff-app bundle (.aab) for Google Play — the only way the app
# reaches phones since 2026-11-27 (owner). Upload it to Play Console → NS Staff →
# Internal testing → Create new release. No APK on the website any more: Play signs
# with its own key, and assetlinks.json already lists it (scripts/set-assetlinks.ps1).
#   pwsh -File phone-app\build-apk.ps1
#
# Asks for the signing key's passwords — only the owner types those; they live in
# this process's environment for the build and are never written down.
# Rebuild only when the native side changes (name, icon, a new plugin or
# permission): the screens are the live website, so a deploy reaches installed
# phones without a new build. Bump versionCode in android/app/build.gradle first —
# Play refuses a code it has already seen — then deploy, and older phones see
# "New version available" (appVersions.ts, AppUpdateBar → the Play listing).
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

# Version into the user agent + appVersions.ts, so older phones are told to update.
. "$PSScriptRoot\..\scripts\stamp-app-version.ps1"
Set-AppVersion -AppDir $PSScriptRoot -UaTag "NSStaffApp" -Constant "STAFF_APP_RELEASE"

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
    .\gradlew.bat bundleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "gradle build failed ($LASTEXITCODE)" }
} finally {
    Pop-Location
    Remove-Item Env:NS_STAFF_KEYSTORE_PASSWORD, Env:NS_STAFF_KEY_PASSWORD -ErrorAction SilentlyContinue
}

Write-Host "Done. Play upload (Internal testing): phone-app\android\app\build\outputs\bundle\release\app-release.aab"
