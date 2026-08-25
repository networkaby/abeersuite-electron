!macro customInstall
  DetailPrint "Configuring Windows Firewall for AbeerSuite..."
  nsExec::Exec 'netsh advfirewall firewall add rule name="AbeerSuite Desktop" dir=in action=allow program="$INSTDIR\AbeerSuite.exe" enable=yes profile=any'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="AbeerSuite Desktop"'
!macroend
