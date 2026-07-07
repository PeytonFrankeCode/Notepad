# Deploy a new app on the EQV server (generic steps)

Run everything in a **PowerShell (Administrator)** window inside an RDP session on
`192.168.10.32`. Replace `<app>`, `<port>`, and `<REPO_ZIP/branch>` for your app.
Set these once at the top of the window:

```powershell
$app  = "myapp"        # folder + Windows service name (lowercase, no spaces)
$port = 3001           # a FREE port from the registry (server-environment.md)
$dir  = "C:\$app"
```

## 1. Get the code onto the server

Private repo → download on your **laptop** (GitHub → the app's branch → **Code →
Download ZIP**), then paste the zip into the server folder over RDP:

```powershell
New-Item -ItemType Directory -Force -Path $dir | Out-Null
explorer $dir
```

Paste the `.zip` into that window, **Extract All…** into `$dir`. If it extracted
into a subfolder, flatten it so `$dir\package.json` sits directly in `$dir`:

```powershell
$sub = Get-ChildItem $dir -Directory | Where-Object { Test-Path "$($_.FullName)\package.json" } | Select-Object -First 1
if ($sub) { Get-ChildItem -LiteralPath $sub.FullName -Force | Move-Item -Destination $dir -Force; Remove-Item $sub.FullName -Recurse -Force }
Test-Path "$dir\package.json"   # -> True
```

*(Alternative: install Git for Windows and `git clone` with a read-only PAT — nicer
for updates, but ZIP needs no credentials on the server.)*

## 2. Install dependencies

```powershell
cd $dir
npm ci --omit=dev            # use `npm install --omit=dev` if there's no lockfile
```

Native modules (e.g. better-sqlite3) fetch prebuilt Windows binaries — no compiler.

## 3. Create the `.env`

```powershell
$secret = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
@"
JWT_SECRET=$secret
HOST=0.0.0.0
PORT=$port
DB_PATH=$dir\data\$app.sqlite
"@ | Set-Content -Encoding ascii "$dir\.env"
```

(Match the key names to what the app expects — see build-conventions.md.)

## 4. Test-run

```powershell
cd $dir
node server/index.js
```

Expect a "listening on http://0.0.0.0:$port" line. Check `http://localhost:$port`
on the server, then `http://192.168.10.32:$port` from a VPN laptop. **Ctrl+C** to
stop, then make it permanent.

## 5. Install as an always-on service (NSSM)

```powershell
# reuse the existing nssm.exe, or download it
$nssm = "C:\nodebook\nssm.exe"
if (-not (Test-Path $nssm)) {
  Invoke-WebRequest https://nssm.cc/release/nssm-2.24.zip -OutFile $env:TEMP\nssm.zip
  Expand-Archive $env:TEMP\nssm.zip -DestinationPath $env:TEMP\nssm -Force
  $nssm = "$dir\nssm.exe"; Copy-Item $env:TEMP\nssm\nssm-2.24\win64\nssm.exe $nssm -Force
}

& $nssm remove $app confirm 2>$null     # clear any earlier stub
New-Item -ItemType Directory -Force -Path "$dir\logs" | Out-Null
& $nssm install $app "C:\Program Files\nodejs\node.exe" "$dir\server\index.js"
& $nssm set $app AppDirectory $dir
& $nssm set $app AppStdout "$dir\logs\out.log"
& $nssm set $app AppStderr "$dir\logs\err.log"
& $nssm set $app Start SERVICE_AUTO_START
& $nssm start $app
Start-Sleep 2; Get-Service $app          # -> Running
```

The service reads `$dir\.env` (via AppDirectory), auto-starts on boot, and
restarts on crash.

## 6. Firewall (usually already fine)

If VPN/LAN clients can reach `http://192.168.10.32:$port`, you're done — the
first interactive `node` run likely created a `node.exe` allow rule. If some
machine can't reach it, add an explicit rule:

```powershell
New-NetFirewallRule -DisplayName "$app $port" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow
```

## 7. Record it

Add the app + port to the registry in `server-environment.md`, and hand out
`http://192.168.10.32:$port`.
