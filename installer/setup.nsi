; Installateur Windows de Camton Live.
; Compilé par scripts/build-installer.mjs avec makensis (aucun Wine requis).
; Installation par utilisateur dans %LOCALAPPDATA%\Programs : pas de UAC.

Unicode true

!define APP_NAME "Camton Live"
!define APP_EXE "Camton Live.exe"
!define PUBLISHER "Camton Live contributors"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CamtonLive"

!ifndef VERSION
  !error "VERSION manquante : compile avec -DVERSION=x.y.z"
!endif
!ifndef OUT
  !error "OUT manquant : compile avec -DOUT=chemin/du/setup.exe"
!endif

Name "${APP_NAME}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\Camton Live"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "${APP_NAME} ${VERSION}"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "Installateur ${APP_NAME}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "© 2026 ${PUBLISHER}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "Comments" "Installateur par utilisateur, sans droits administrateur"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define MUI_ICON "..\build\icon.ico"
!define MUI_UNICON "..\build\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer ${APP_NAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "French"

; Ferme l'application en cours : indispensable en mise à jour silencieuse,
; sinon Windows garde l'exécutable verrouillé et la copie échoue.
!macro CloseRunningApp
  nsExec::Exec 'taskkill /IM "${APP_EXE}" /T /F'
  Pop $0
  Sleep 1500
!macroend

Section "Application" SecApp
  SetShellVarContext current
  !insertmacro CloseRunningApp

  ; Windows garde l'exécutable verrouillé quelques secondes après la fermeture de
  ; l'application. En mode silencieux, NSIS saute alors les fichiers sans message :
  ; l'utilisateur voit « installé » et garde l'ancienne version. On attend donc que
  ; le fichier soit réellement supprimable, jusqu'à 30 secondes.
  StrCpy $1 0
  camton_attente:
    Delete "$INSTDIR\${APP_EXE}"
    IfFileExists "$INSTDIR\${APP_EXE}" 0 camton_verifie
    IntOp $1 $1 + 1
    IntCmp $1 30 camton_verifie camton_pause camton_verifie
  camton_pause:
    Sleep 1000
    Goto camton_attente
  camton_verifie:
  ; Si l'exécutable résiste encore, la copie serait partielle et silencieuse :
  ; mieux vaut échouer, l'application signalera l'échec au redémarrage.
  IfFileExists "$INSTDIR\${APP_EXE}" camton_verrouille camton_copie
  camton_verrouille:
    SetErrorLevel 1
    IfSilent camton_abandon 0
    MessageBox MB_ICONSTOP "Camton Live est encore ouvert. Ferme-le, puis relance l'installation."
  camton_abandon:
    Quit

  camton_copie:
  Delete "$INSTDIR\resources\app.asar"

  SetOutPath "$INSTDIR"
  File /r "..\release\win-unpacked\*.*"

  WriteUninstaller "$INSTDIR\Uninstall ${APP_NAME}.exe"

  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\Désinstaller ${APP_NAME}.lnk" "$INSTDIR\Uninstall ${APP_NAME}.exe"

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall ${APP_NAME}.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall ${APP_NAME}.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"

  ; En mise à jour silencieuse, personne ne relance l'application : sans cela
  ; l'utilisateur reste devant une fenêtre fermée et croit que rien ne s'est passé.
  FileOpen $2 "$INSTDIR\version-installee.txt" w
  FileWrite $2 "${VERSION}$\r$\n"
  FileClose $2
  IfSilent 0 camton_fin
  Exec '"$INSTDIR\${APP_EXE}"'
  camton_fin:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  !insertmacro CloseRunningApp

  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Désinstaller ${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"

  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd
