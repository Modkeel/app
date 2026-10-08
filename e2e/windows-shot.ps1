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

# Which icon the taskbar can get from the app: for each visible top-level window of the
# process, its big/small icons (WM_GETICON) and its class icons, each saved as a PNG next to
# the screenshots, plus the icon Explorer extracts from the exe. A zero handle is "not set".
$IconTypes = @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
using System.Text;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", EntryPoint="GetClassLongPtrW")] public static extern IntPtr GetClassLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  public static List<IntPtr> Of(uint pid) {
    var r = new List<IntPtr>();
    EnumWindows((h, p) => { uint q; GetWindowThreadProcessId(h, out q);
      if (q == pid && IsWindowVisible(h)) r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }
}
"@

function IconReport([int]$procId, [string]$exePath) {
  Add-Type -TypeDefinition $IconTypes
  $assoc = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath)
  $assoc.ToBitmap().Save("e2e/shots/icon-exe.png", [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "icon: exe associated $($assoc.Width)x$($assoc.Height) -> icon-exe.png"
  $i = 0
  foreach ($h in [Win]::Of([uint32]$procId)) {
    $title = New-Object System.Text.StringBuilder 256; $cls = New-Object System.Text.StringBuilder 256
    [void][Win]::GetWindowText($h, $title, 256); [void][Win]::GetClassName($h, $cls, 256)
    $owner = [Win]::GetWindow($h, 4)                      # GW_OWNER
    $exStyle = [Win]::GetWindowLong($h, -20)              # GWL_EXSTYLE
    Write-Host ("icon: window {0} '{1}' class={2} owner={3} exstyle=0x{4:x}" -f $h, $title, $cls, $owner, $exStyle)
    $handles = [ordered]@{
      big    = [Win]::SendMessage($h, 0x7F, [IntPtr]1, [IntPtr]0)  # WM_GETICON ICON_BIG
      small  = [Win]::SendMessage($h, 0x7F, [IntPtr]0, [IntPtr]0)  # ICON_SMALL
      small2 = [Win]::SendMessage($h, 0x7F, [IntPtr]2, [IntPtr]0)  # ICON_SMALL2
      class  = [Win]::GetClassLongPtr($h, -14)                     # GCLP_HICON
      classsm = [Win]::GetClassLongPtr($h, -34)                    # GCLP_HICONSM
    }
    foreach ($k in $handles.Keys) {
      $v = $handles[$k]
      $line = "icon:   $k = $v"
      if ($v -ne [IntPtr]::Zero) {
        $ic = [System.Drawing.Icon]::FromHandle($v)
        $ic.ToBitmap().Save("e2e/shots/icon-w$i-$k.png", [System.Drawing.Imaging.ImageFormat]::Png)
        $line += " ($($ic.Width)x$($ic.Height)) -> icon-w$i-$k.png"
      }
      Write-Host $line
    }
    $i++
  }
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
try { IconReport $app.Id $exe.FullName } catch { Write-Host "icon: report failed: $_" }

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
