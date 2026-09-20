' ==========================================================
'  EL GUSTAZO - LANZADOR SILENCIOSO PARA WINDOWS 8
'  Ejecuta el servidor en segundo plano sin ventana negra
' ==========================================================
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Obtener la ruta de la carpeta del script
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)

' Establecer variable de entorno para compatibilidad con Windows 8
WshShell.Environment("PROCESS")("NODE_SKIP_PLATFORM_CHECK") = "1"

' Comando para iniciar el servidor Node
NodeCmd = "cmd.exe /c cd /d """ & ScriptDir & """ && set NODE_SKIP_PLATFORM_CHECK=1 && node src/server.js"

' Ejecutar en modo oculto (0 = oculto, False = no esperar a que termine)
WshShell.Run NodeCmd, 0, False

' Esperar 2 segundos para que el servidor levante
WScript.Sleep 2000

' Abrir el sistema en el navegador predeterminado
WshShell.Run "http://localhost:3000", 1, False
