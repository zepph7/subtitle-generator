; Subtitle Generator - requirements check for the NSIS installer (electron-builder).
;
; After the "choose install folder" page and before files are installed, a
; "Required components" page checks this computer for:
;   - Python 3.10+                       (app runs engine.py with it)
;   - faster-whisper (pip package)       (the transcription engine)
;   - Microsoft Visual C++ Runtime x64   (needed by faster-whisper's ctranslate2)
; Anything missing is offered with a ticked "Install" box. The page is skipped
; when everything is already present. The chosen installs run during the
; install step, with progress in the "Show details" log.
;
; The Python that was found or installed is written to
; $INSTDIR\resources\python-path.txt; main.js uses it, so the app works even
; when PATH has not been refreshed yet (e.g. "Run Subtitle Generator" on the
; finish page right after Python was installed).

!define REQ_PY_VERSION "3.12.10"
!define REQ_PY_URL     "https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe"
!define REQ_VC_URL     "https://aka.ms/vs/17/release/vc_redist.x64.exe"
!define REQ_PY_CHECK   "import sys; assert sys.version_info >= (3, 10); print(sys.executable)"

!macro customPageAfterChangeDir
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var ReqDetected   ; "1" once ReqDetect has run
  Var ReqPython     ; full path of a working python.exe, "" if none
  Var ReqHasFW      ; "1" if faster-whisper imports
  Var ReqHasVC      ; "1" if the VC++ x64 runtime is installed
  Var ReqChkPy
  Var ReqChkVC
  Var ReqChkFW
  Var ReqDoPy       ; "1" = install during the install step
  Var ReqDoVC
  Var ReqDoFW
  Var ReqFailed     ; text of anything that failed to install

  Page custom ReqPageCreate ReqPageLeave

  ; ---------------------------------------------------------------- detection

  ; Strip trailing CR/LF/spaces from $R0.
  Function ReqTrim
    ReqTrimLoop:
      StrCpy $R9 $R0 1 -1
      ${If} $R9 == "$\r"
      ${OrIf} $R9 == "$\n"
      ${OrIf} $R9 == " "
        StrCpy $R0 $R0 -1
        Goto ReqTrimLoop
      ${EndIf}
  FunctionEnd

  ; $R1 = command that starts Python (e.g. python, py -3, "C:\...\python.exe").
  ; Sets $ReqPython if it is a real Python >= 3.10.
  Function ReqTryPython
    ${If} $ReqPython != ""
      Return
    ${EndIf}
    nsExec::ExecToStack '$R1 -c "${REQ_PY_CHECK}"'
    Pop $0
    Pop $R0
    ${If} $0 == 0
      Call ReqTrim
      ${If} ${FileExists} "$R0"
        StrCpy $ReqPython $R0
      ${EndIf}
    ${EndIf}
  FunctionEnd

  ; Try every Python registered under $R2 (root: 0 = HKCU, 1 = HKLM).
  Function ReqTryRegistry
    StrCpy $R3 0
    ReqRegLoop:
      ${If} $ReqPython != ""
        Return
      ${EndIf}
      ${If} $R2 == 0
        EnumRegKey $R4 HKCU "Software\Python\PythonCore" $R3
      ${Else}
        EnumRegKey $R4 HKLM "Software\Python\PythonCore" $R3
      ${EndIf}
      StrCmp $R4 "" ReqRegDone
      ${If} $R2 == 0
        ReadRegStr $R5 HKCU "Software\Python\PythonCore\$R4\InstallPath" "ExecutablePath"
      ${Else}
        ReadRegStr $R5 HKLM "Software\Python\PythonCore\$R4\InstallPath" "ExecutablePath"
      ${EndIf}
      ${If} ${FileExists} "$R5"
        StrCpy $R1 '"$R5"'
        Call ReqTryPython
      ${EndIf}
      IntOp $R3 $R3 + 1
      Goto ReqRegLoop
    ReqRegDone:
  FunctionEnd

  Function ReqDetect
    StrCpy $ReqPython ""
    StrCpy $ReqHasFW ""
    StrCpy $ReqHasVC ""

    ; Python: PATH, then the py launcher, then the registry (fresh installs).
    StrCpy $R1 "python"
    Call ReqTryPython
    StrCpy $R1 "py -3"
    Call ReqTryPython
    SetRegView 64
    StrCpy $R2 0
    Call ReqTryRegistry
    StrCpy $R2 1
    Call ReqTryRegistry
    SetRegView 32
    ${If} $ReqPython == ""
    ${AndIf} ${FileExists} "$LOCALAPPDATA\Programs\Python\Python312\python.exe"
      StrCpy $R1 '"$LOCALAPPDATA\Programs\Python\Python312\python.exe"'
      Call ReqTryPython
    ${EndIf}

    ; faster-whisper
    ${If} $ReqPython != ""
      nsExec::ExecToStack '"$ReqPython" -c "import faster_whisper"'
      Pop $0
      Pop $1
      ${If} $0 == 0
        StrCpy $ReqHasFW 1
      ${EndIf}
    ${EndIf}

    ; Visual C++ 2015-2022 runtime, x64
    SetRegView 64
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    SetRegView 32
    ${If} $0 == 1
      StrCpy $ReqHasVC 1
    ${Else}
      ReadRegDWORD $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
      ${If} $0 == 1
        StrCpy $ReqHasVC 1
      ${EndIf}
    ${EndIf}

    StrCpy $ReqDetected 1
  FunctionEnd

  ; ------------------------------------------------------------------- page

  Function ReqPageCreate
    StrCpy $ReqDoPy ""
    StrCpy $ReqDoVC ""
    StrCpy $ReqDoFW ""
    Banner::show /NOUNLOAD "Checking required components..."
    Call ReqDetect
    Banner::destroy

    ${If} $ReqPython != ""
    ${AndIf} $ReqHasFW == 1
    ${AndIf} $ReqHasVC == 1
      Abort   ; everything is present - skip this page
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "Required components" "Subtitle Generator needs these programs to create subtitles."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 20u "Some components are missing on this computer. Tick the ones to download and install now (an internet connection is required)."
    Pop $0

    ; Python
    ${If} $ReqPython != ""
      ${NSD_CreateLabel} 0 28u 100% 12u "Found:  Python  ($ReqPython)"
      Pop $0
      StrCpy $ReqChkPy ""
    ${Else}
      ${NSD_CreateCheckbox} 0 26u 100% 12u "Install Python ${REQ_PY_VERSION}  (about 25 MB download)"
      Pop $ReqChkPy
      ${NSD_Check} $ReqChkPy
    ${EndIf}

    ; faster-whisper
    ${If} $ReqHasFW == 1
      ${NSD_CreateLabel} 0 48u 100% 12u "Found:  faster-whisper"
      Pop $0
      StrCpy $ReqChkFW ""
    ${Else}
      ${NSD_CreateCheckbox} 0 46u 100% 12u "Install faster-whisper with pip  (about 300 MB download, can take several minutes)"
      Pop $ReqChkFW
      ${NSD_Check} $ReqChkFW
    ${EndIf}

    ; VC++ runtime
    ${If} $ReqHasVC == 1
      ${NSD_CreateLabel} 0 68u 100% 12u "Found:  Microsoft Visual C++ Runtime (x64)"
      Pop $0
      StrCpy $ReqChkVC ""
    ${Else}
      ${NSD_CreateCheckbox} 0 66u 100% 12u "Install Microsoft Visual C++ Runtime x64  (about 25 MB, Windows will ask for permission)"
      Pop $ReqChkVC
      ${NSD_Check} $ReqChkVC
    ${EndIf}

    ${NSD_CreateLabel} 0 92u 100% 30u "Anything you leave unticked must be installed later by hand, otherwise the app cannot create subtitles. The Whisper model itself downloads automatically the first time you use it."
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function ReqPageLeave
    ${If} $ReqChkPy != ""
      ${NSD_GetState} $ReqChkPy $ReqDoPy
    ${EndIf}
    ${If} $ReqChkFW != ""
      ${NSD_GetState} $ReqChkFW $ReqDoFW
    ${EndIf}
    ${If} $ReqChkVC != ""
      ${NSD_GetState} $ReqChkVC $ReqDoVC
    ${EndIf}

    ; faster-whisper needs Python.
    ${If} $ReqDoFW == ${BST_CHECKED}
    ${AndIf} $ReqPython == ""
    ${AndIf} $ReqDoPy != ${BST_CHECKED}
      MessageBox MB_ICONEXCLAMATION|MB_OK "faster-whisper is installed with Python, so Python must be installed too.$\r$\nTick Python as well, or untick faster-whisper."
      Abort
    ${EndIf}

    ${If} $ReqChkPy != ""
    ${AndIf} $ReqDoPy != ${BST_CHECKED}
      Goto ReqWarnSkip
    ${EndIf}
    ${If} $ReqChkFW != ""
    ${AndIf} $ReqDoFW != ${BST_CHECKED}
      Goto ReqWarnSkip
    ${EndIf}
    ${If} $ReqChkVC != ""
    ${AndIf} $ReqDoVC != ${BST_CHECKED}
      Goto ReqWarnSkip
    ${EndIf}
    Return

    ReqWarnSkip:
      MessageBox MB_ICONQUESTION|MB_YESNO "Some required components will not be installed.$\r$\nThe app will not be able to create subtitles until they are installed.$\r$\n$\r$\nContinue anyway?" IDYES +2
      Abort
  FunctionEnd

  ; ---------------------------------------------------------------- install

  ; $R6 = URL, $R7 = target file. Sets $0 = 0 on success.
  Function ReqDownload
    Delete "$R7"
    nsExec::ExecToLog '"$SYSDIR\curl.exe" --location --fail --silent --show-error --retry 3 --output "$R7" "$R6"'
    Pop $0
    ${If} $0 != 0
      ; Fallback for systems without curl.exe
      nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; Invoke-WebRequest -UseBasicParsing -Uri '$R6' -OutFile '$R7'"`
      Pop $0
    ${EndIf}
    ${IfNot} ${FileExists} "$R7"
      StrCpy $0 1
    ${EndIf}
  FunctionEnd

  Function ReqInstall
    StrCpy $ReqFailed ""
    InitPluginsDir

    ; 1) Visual C++ runtime (needs admin; started elevated via PowerShell)
    ${If} $ReqDoVC == ${BST_CHECKED}
      DetailPrint "Downloading Microsoft Visual C++ Runtime..."
      StrCpy $R6 "${REQ_VC_URL}"
      StrCpy $R7 "$PLUGINSDIR\vc_redist.x64.exe"
      Call ReqDownload
      ${If} $0 == 0
        DetailPrint "Installing Microsoft Visual C++ Runtime (Windows will ask for permission)..."
        nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$p = Start-Process -FilePath '$R7' -ArgumentList '/install','/quiet','/norestart' -Verb RunAs -Wait -PassThru; exit $$p.ExitCode"`
        Pop $0
        Pop $1
        ; 3010 = needs reboot, 1638 = newer version already installed
        ${If} $0 == 0
        ${OrIf} $0 == 3010
        ${OrIf} $0 == 1638
          DetailPrint "Visual C++ Runtime installed."
        ${Else}
          DetailPrint "Visual C++ Runtime install failed or was cancelled (code $0)."
          StrCpy $ReqFailed "$ReqFailed$\r$\n - Microsoft Visual C++ Runtime (https://aka.ms/vs/17/release/vc_redist.x64.exe)"
        ${EndIf}
      ${Else}
        StrCpy $ReqFailed "$ReqFailed$\r$\n - Microsoft Visual C++ Runtime: download failed"
      ${EndIf}
    ${EndIf}

    ; 2) Python (per-user, no admin rights needed, added to PATH)
    ${If} $ReqDoPy == ${BST_CHECKED}
      DetailPrint "Downloading Python ${REQ_PY_VERSION}..."
      StrCpy $R6 "${REQ_PY_URL}"
      StrCpy $R7 "$PLUGINSDIR\python-installer.exe"
      Call ReqDownload
      ${If} $0 == 0
        DetailPrint "Installing Python ${REQ_PY_VERSION} (this can take a few minutes)..."
        ExecWait '"$R7" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 InstallLauncherAllUsers=0 Include_test=0 Include_doc=0' $0
        DetailPrint "Python installer finished (code $0)."
        Call ReqDetect
        ${If} $ReqPython == ""
          StrCpy $ReqFailed "$ReqFailed$\r$\n - Python ${REQ_PY_VERSION} (https://www.python.org/downloads/)"
        ${EndIf}
      ${Else}
        StrCpy $ReqFailed "$ReqFailed$\r$\n - Python: download failed"
      ${EndIf}
    ${EndIf}

    ; 3) faster-whisper
    ${If} $ReqDoFW == ${BST_CHECKED}
      ${If} $ReqPython == ""
        StrCpy $ReqFailed "$ReqFailed$\r$\n - faster-whisper (Python is not available)"
      ${Else}
        DetailPrint "Installing faster-whisper with pip (large download, please wait)..."
        nsExec::ExecToLog '"$ReqPython" -m pip install --upgrade --disable-pip-version-check faster-whisper'
        Pop $0
        nsExec::ExecToStack '"$ReqPython" -c "import faster_whisper"'
        Pop $0
        Pop $1
        ${If} $0 == 0
          DetailPrint "faster-whisper installed."
        ${Else}
          StrCpy $ReqFailed "$ReqFailed$\r$\n - faster-whisper (run: $\"$ReqPython$\" -m pip install faster-whisper)"
        ${EndIf}
      ${EndIf}
    ${EndIf}

    ; Tell the app which Python to use.
    ${If} $ReqDetected != 1
      Call ReqDetect      ; page was skipped (silent install / update)
    ${EndIf}
    ${If} $ReqPython != ""
      FileOpen $1 "$INSTDIR\resources\python-path.txt" w
      FileWrite $1 "$ReqPython"
      FileClose $1
      DetailPrint "App will use Python at $ReqPython"
    ${Else}
      Delete "$INSTDIR\resources\python-path.txt"
    ${EndIf}

    ${If} $ReqFailed != ""
      MessageBox MB_ICONEXCLAMATION|MB_OK "Subtitle Generator was installed, but these components could not be installed:$ReqFailed$\r$\n$\r$\nInstall them by hand, then start the app again." /SD IDOK
    ${EndIf}
  FunctionEnd
!macroend

!macro customInstall
  Call ReqInstall
!macroend
