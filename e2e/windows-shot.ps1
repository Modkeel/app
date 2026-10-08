# Install the NSIS build silently, open the app as a player would, type a get with the
# keyboard (Mod field first in tab order; Enter in the Minecraft field submits), and take
# screenshots: e2e/shots/windows-1-open.png, windows-2-get.png. For CI (app-release.yml).
param([string]$Installer)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

function Shot([string]$name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  New-Item -ItemType Directory -Force -Path "e2e/shots" | Out-Null
  $bmp.Save("e2e/shots/$name", [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "shot: $name"
}

Start-Process -FilePath $Installer -ArgumentList "/S" -Wait
$exe = Get-ChildItem "$env:LOCALAPPDATA\Modkeel", "$env:ProgramFiles\Modkeel" -Filter *.exe -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notmatch "uninstall|modkeel-engine" } | Select-Object -First 1
if (-not $exe) { throw "installed app not found" }
Write-Host "app: $($exe.FullName)"
Get-ChildItem $exe.DirectoryName | ForEach-Object { Write-Host "  $($_.Name)" }

$app = Start-Process -FilePath $exe.FullName -PassThru
Start-Sleep -Seconds 20
Shot "windows-1-open.png"

$shell = New-Object -ComObject WScript.Shell
$null = $shell.AppActivate($app.Id)
Start-Sleep -Seconds 1
[System.Windows.Forms.SendKeys]::SendWait("{TAB}")
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("Sodium{TAB}1.21.10{ENTER}")
Start-Sleep -Seconds 45
Shot "windows-2-get.png"

$downloads = Join-Path $env:USERPROFILE "Downloads\Modkeel"
Get-ChildItem $downloads -Recurse -Filter *.jar -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "jar: $($_.FullName)" }
Write-Host "engine processes: $((Get-Process modkeel-engine -ErrorAction SilentlyContinue).Count)"
Stop-Process -Id $app.Id -ErrorAction SilentlyContinue
