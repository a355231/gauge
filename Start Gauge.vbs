' Launch Gauge into the system tray with no console window.
Dim fso, shell, here, exe
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
exe = here & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(exe) Then
  MsgBox "Gauge is not installed yet." & vbCrLf & vbCrLf & _
         "Open a terminal in this folder and run:  npm install", 48, "Gauge"
  WScript.Quit 1
End If

shell.CurrentDirectory = here
shell.Run """" & exe & """ """ & here & """", 0, False
