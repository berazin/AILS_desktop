!macro customHeader
  !include "getProcessInfo.nsh"
  Var pid
  # The builder may append plugin directories after the custom include.
  # Define plugin-using functions only once its entire shared header is read.
  !ifmacrodef AILS_DEFINE_FFMPEG_FUNCTION
    !insertmacro AILS_DEFINE_FFMPEG_FUNCTION
  !endif
  !ifmacrodef AILS_DEFINE_USER_STATE_FUNCTIONS
    !insertmacro AILS_DEFINE_USER_STATE_FUNCTIONS
  !endif
  !ifmacrodef AILS_DEFINE_PROCESS_CLEANUP_FUNCTIONS
    !insertmacro AILS_DEFINE_PROCESS_CLEANUP_FUNCTIONS
  !endif
!macroend

!macro customInit
  # A staged request must never drop into the normal uninstall path if its
  # session argument is absent or malformed.
  ${StdUtils.TestParameter} $1 "ails-staged-update"
  ${StdUtils.GetParameter} $0 "ails-update-session" ""
  ${If} $1 == "true"
    ${If} $0 == ""
      SetErrorLevel 20
      Quit
    ${EndIf}
  ${ElseIf} $0 != ""
    SetErrorLevel 20
    Quit
  ${EndIf}
  # Elevated assisted installers skip CHECK_APP_RUNNING in their inner process.
  # Refuse that path before the stock installer could uninstall the running app.
  ${If} $0 != ""
    !ifdef INSTALL_MODE_PER_ALL_USERS
      SetErrorLevel 24
      Quit
    !else
      !ifndef ONE_CLICK
        ${If} $hasPerMachineInstallation == "1"
          SetErrorLevel 24
          Quit
        ${EndIf}
      !endif
      ${If} $installMode == "all"
        SetErrorLevel 24
        Quit
      ${EndIf}
    !endif
  ${EndIf}
!macroend

!macro AILS_STAGE_PHASE PHASE
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\staged-update.ps1" -Phase "${PHASE}" -SessionDir "$ailsSessionDir" -SessionId "$ailsSessionId" -InstallDir "$ailsInstallDir" -ExecutableName "${APP_EXECUTABLE_FILENAME}" -Version "${VERSION}" -RequireFfmpeg'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    DetailPrint "$1"
    SetErrorLevel 21
    Quit
  ${EndIf}
!macroend

!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    Var /GLOBAL ailsSessionDir
    Var /GLOBAL ailsSessionId
    Var /GLOBAL ailsInstallDir
    ${StdUtils.GetParameter} $ailsSessionDir "ails-update-session" ""
    ${If} $ailsSessionDir != ""
      ${IfNot} ${isUpdated}
        SetErrorLevel 20
        Quit
      ${EndIf}
      ${IfNot} ${Silent}
        SetErrorLevel 20
        Quit
      ${EndIf}
      ${StdUtils.GetParameter} $ailsSessionId "ails-update-id" ""
      StrCpy $ailsInstallDir "$INSTDIR"
      File /oname=$PLUGINSDIR\staged-update.ps1 "${BUILD_RESOURCES_DIR}\staged-update.ps1"
      File /oname=$PLUGINSDIR\user-state.ps1 "${BUILD_RESOURCES_DIR}\user-state.ps1"
      File /oname=$PLUGINSDIR\reuse-ffmpeg.ps1 "${BUILD_RESOURCES_DIR}\reuse-ffmpeg.ps1"
      !insertmacro AILS_STAGE_PHASE "Initialize"
      SetOutPath "$ailsInstallDir.ails-update-$ailsSessionId"
      # Reuse the embedded x64 archive. All developer release targets are x64.
      # Extraction writes only to staging; it never touches the running app.
      !ifdef COMPRESS
        SetCompress off
      !endif
      !insertmacro x64_app_files
      !ifdef COMPRESS
        SetCompress "${COMPRESS}"
      !endif
      !ifdef ZIP_COMPRESSION
        nsisunz::Unzip "$PLUGINSDIR\app-64.zip" "$OUTDIR"
        Pop $0
        ${If} $0 != "success"
          SetErrorLevel 22
          Quit
        ${EndIf}
      !else
        Nsis7z::Extract "$PLUGINSDIR\app-64.7z"
      !endif
      File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"
      !ifdef UNINSTALLER_ICON
        File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
      !endif
      SetOutPath "$PLUGINSDIR"
      !insertmacro AILS_STAGE_PHASE "Tools"
      StrCpy $INSTDIR "$ailsInstallDir.ails-update-$ailsSessionId"
      !insertmacro customInstall
      StrCpy $INSTDIR "$ailsInstallDir"
      # Prepare the cache used by the next differential download while AILS
      # is still open, rather than copying the installer during cutover.
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}
      !insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
      ${If} ${Errors}
        SetErrorLevel 23
        Quit
      ${EndIf}
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
      !insertmacro AILS_STAGE_PHASE "Finish"

      # Finish already moved the fully verified directory into place. Keep the
      # previous tree for recovery until the new app's backend is healthy.
      !insertmacro registryAddInstallInfo
      # Existing shortcuts still point to this same installation path. Keep
      # them intact; the normal installer declares its shortcut variables later.
      !ifmacrodef registerFileAssociations
        !insertmacro registerFileAssociations
      !endif
      StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      # StartApp declares a global variable; the standard install path already
      # expands it. Launch this completed update without declaring it twice.
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
      !insertmacro quitSuccess
    ${EndIf}
  !endif
  # Fresh installs and old updaters keep the standard installer path.
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
  Call AilsStopInstalledProcesses
  Call AilsCacheInstalledFfmpeg
  Call AilsBackupUserState
  !endif
!macroend
