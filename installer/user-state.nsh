!macro AILS_DEFINE_USER_STATE_FUNCTIONS
!ifndef BUILD_UNINSTALLER
Var /GLOBAL ailsUserStateBackup
Function AilsBackupUserState
  ReadRegStr $0 SHCTX "Software\${APP_GUID}" InstallLocation
  StrCmp $0 "" ails_state_backup_done
  InitPluginsDir
  File /oname=$PLUGINSDIR\user-state.ps1 "${BUILD_RESOURCES_DIR}\user-state.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\user-state.ps1" -Phase Backup -InstallDir "$0" -BackupBase "$LOCALAPPDATA\AILS\backups"'
  Pop $0
  Pop $ailsUserStateBackup
  StrCmp $0 "0" ails_state_backup_done
  DetailPrint "$ailsUserStateBackup"
  ${IfNot} ${Silent}
    MessageBox MB_ICONSTOP "AILS user-state backup failed. The existing installation has not been removed."
  ${EndIf}
  SetErrorLevel 25
  Quit
  ails_state_backup_done:
FunctionEnd

Function AilsRestoreUserState
  StrCmp $ailsUserStateBackup "" ails_state_restore_done
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\user-state.ps1" -Phase Restore -InstallDir "$INSTDIR" -BackupDir "$ailsUserStateBackup"'
  Pop $0
  Pop $1
  StrCmp $0 "0" ails_state_restore_done
  DetailPrint "$1"
  ${IfNot} ${Silent}
    MessageBox MB_ICONSTOP "AILS user-state restore failed. The verified backup is retained at $ailsUserStateBackup."
  ${EndIf}
  SetErrorLevel 26
  Quit
  ails_state_restore_done:
FunctionEnd
!endif
!macroend
