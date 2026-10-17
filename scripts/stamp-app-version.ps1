# Stamps an Android app's version (from android/app/build.gradle) into the two
# places that tell phones to update — dot-source it from a build-apk.ps1:
#   . "$PSScriptRoot\..\scripts\stamp-app-version.ps1"
#   Set-AppVersion -AppDir $PSScriptRoot -UaTag "NSStaffApp" -Constant "STAFF_APP_RELEASE"
#
#  1. capacitor.config.json appendUserAgent = "<UaTag>/<versionCode>" — the
#     installed app reports its own version on every page (AppUpdateBar reads it);
#  2. src/shared/lib/constants/appVersions.ts <Constant> code + name — the latest
#     build the website knows about; older phones see "New version available".
# `urgent` in appVersions.ts is left as it is (set by hand).
function Set-AppVersion {
    param([string]$AppDir, [string]$UaTag, [string]$Constant)
    $gradle = Get-Content (Join-Path $AppDir "android\app\build.gradle") -Raw
    $code = [regex]::Match($gradle, 'versionCode\s+(\d+)').Groups[1].Value
    $name = [regex]::Match($gradle, 'versionName\s+"([^"]+)"').Groups[1].Value
    if (-not $code -or -not $name) { throw "versionCode / versionName not found in build.gradle" }

    $configPath = Join-Path $AppDir "capacitor.config.json"
    $config = Get-Content $configPath -Raw
    $config = [regex]::Replace($config, '"appendUserAgent":\s*"[^"]*"', "`"appendUserAgent`": `"$UaTag/$code`"")
    [System.IO.File]::WriteAllText($configPath, $config)

    $constPath = Join-Path $AppDir "..\src\shared\lib\constants\appVersions.ts"
    $ts = Get-Content $constPath -Raw
    $ts = [regex]::Replace($ts, "($Constant`: AppRelease = \{ code: )\d+(, name: `")[^`"]*(`")", "`${1}$code`${2}$name`${3}")
    [System.IO.File]::WriteAllText($constPath, $ts)
    Write-Host "Version $name (code $code) stamped: user agent $UaTag/$code, $Constant."
}
