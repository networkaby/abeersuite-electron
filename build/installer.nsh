; ── Visual C++ runtime pre-install audit ─────────────────────────────────────
; The embedded PostgreSQL (resources/pgsql) is a Microsoft-toolchain build and
; needs the VC++ 2015-2022 x64 shared runtime (vcruntime140.dll, msvcp140.dll).
; A clean counter PC does not have it: initdb then dies with 0xC0000135
; (STATUS_DLL_NOT_FOUND), the app silently falls back to live mode, and counter
; onboarding cannot start its local sync (see postgresManager.ts).
;
; Not bundled — it would add ~25 MB to every installer and every update. A counter
; is bound online, so internet at install time is a given: check the registry, and
; download from Microsoft only when the runtime is missing. AbeerSuite-WebSetup.exe
; runs the same audit first, so this usually finds it already present and skips.
!define VCREDIST_URL "https://aka.ms/vs/17/release/vc_redist.x64.exe"
!define VCREDIST_KEY "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64"
; 14.20 = VS2019 — the floor the bundled PostgreSQL was linked against.
!define VCREDIST_MIN_MINOR 20

!macro ensureVcRuntime
  SetRegView 64
  ReadRegDWORD $0 HKLM "${VCREDIST_KEY}" "Installed"
  ReadRegDWORD $1 HKLM "${VCREDIST_KEY}" "Major"
  ReadRegDWORD $2 HKLM "${VCREDIST_KEY}" "Minor"
  SetRegView lastused
  ${If} $0 == 1
  ${AndIf} $1 >= 14
  ${AndIf} $2 >= ${VCREDIST_MIN_MINOR}
    DetailPrint "Visual C++ runtime $1.$2 already installed — skipping."
  ${Else}
  DetailPrint "Visual C++ runtime missing — downloading from Microsoft..."
  inetc::get /USERAGENT "AbeerSuite-Setup" /RESUME "" "${VCREDIST_URL}" "$PLUGINSDIR\vc_redist.x64.exe" /END
  Pop $0
  ${If} $0 != "OK"
    MessageBox MB_OK|MB_ICONSTOP "AbeerSuite needs the Microsoft Visual C++ 2015-2022 (x64) runtime for its local database, and it could not be downloaded ($0).$\r$\n$\r$\nConnect to the internet and run this setup again, or install it yourself from:$\r$\n${VCREDIST_URL}"
    Abort "Visual C++ runtime download failed: $0"
  ${EndIf}

  DetailPrint "Installing Visual C++ runtime..."
  ; ExecShellWait so the redistributable's own elevation applies even when this
  ; installer is running per-user. 0 = ok, 3010 = ok but reboot pending, 1638 = a
  ; newer version is already present.
  ExecShellWait "runas" "$PLUGINSDIR\vc_redist.x64.exe" "/install /quiet /norestart"
  Pop $0
  ${If} $0 == 0
  ${OrIf} $0 == 3010
  ${OrIf} $0 == 1638
    DetailPrint "Visual C++ runtime installed (exit $0)."
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP "The Visual C++ runtime installer failed (exit code $0). AbeerSuite's local database cannot start without it.$\r$\n$\r$\nInstall it yourself from:$\r$\n${VCREDIST_URL}$\r$\nthen run this setup again."
    Abort "Visual C++ runtime install failed: $0"
  ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro ensureVcRuntime

  DetailPrint "Configuring Windows Firewall for AbeerSuite..."
  nsExec::Exec 'netsh advfirewall firewall add rule name="AbeerSuite Desktop" dir=in action=allow program="$INSTDIR\AbeerSuite.exe" enable=yes profile=any'
  DetailPrint "Windows Firewall rule added."
!macroend

!macro customUnInstall
  DetailPrint "Removing Windows Firewall rule for AbeerSuite..."
  nsExec::Exec 'netsh advfirewall firewall delete rule name="AbeerSuite Desktop"'
!macroend
