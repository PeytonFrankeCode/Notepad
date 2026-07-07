# Deploying Nodebook on Windows Server (step by step)

For hosting Nodebook on a **Windows Server** box reached over your network/VPN.
No prior experience assumed. You'll run every command in a **PowerShell
(Administrator)** window inside your Remote Desktop session.

Assumes Node.js is already installed (`node --version` prints v22.x). The app
listens on the server's LAN address (e.g. `192.168.10.32`), so anyone routed to
that network — including WireGuard VPN clients — can reach it, while outside
users cannot.

---

## Step 1 — Put the code in `C:\nodebook`

On **your laptop** (signed into GitHub): open the repo → branch
**`claude/notetaking-daily-backlinks-vzf64y`** → green **Code** button →
**Download ZIP**.

In the **Remote Desktop** session, make the folder and open it:

```powershell
New-Item -ItemType Directory -Force -Path C:\nodebook | Out-Null
explorer C:\nodebook
```

Copy the downloaded `.zip` from your laptop and paste it into that `C:\nodebook`
window (Remote Desktop shares your clipboard). Right-click the zip →
**Extract All…** → extract into `C:\nodebook`. The files may land in a subfolder
like `C:\nodebook\Notepad-claude-...`; if so, move everything up so that
`C:\nodebook\package.json` and `C:\nodebook\server` exist directly.

Confirm:

```powershell
Test-Path C:\nodebook\package.json    # should print True
```

## Step 2 — Install dependencies

```powershell
cd C:\nodebook
npm ci --omit=dev
```

(If `npm ci` complains about a missing lock file, use `npm install --omit=dev`.)

## Step 3 — Create the config file

Nodebook reads settings from a `.env` file. Generate a secret and write it:

```powershell
cd C:\nodebook
$secret = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
@"
JWT_SECRET=$secret
HOST=0.0.0.0
PORT=3000
DB_PATH=C:\nodebook\data\nodebook.sqlite
"@ | Set-Content -Encoding ascii C:\nodebook\.env
```

`HOST=0.0.0.0` means "listen on all of the server's addresses" — since this
server only has a private network address, that's your LAN/VPN address and not
the public internet. Keep `.env` private (it holds your session secret).

## Step 4 — Test-run it

```powershell
cd C:\nodebook
node server/index.js
```

You should see `Nodebook (self-hosted) listening on http://0.0.0.0:3000`.
On the server, open a browser to <http://localhost:3000> — you should get the
sign-up screen. Then from a laptop **on the VPN**, open
`http://<SERVER-LAN-IP>:3000` (e.g. `http://192.168.10.32:3000`).

Press **Ctrl+C** in PowerShell to stop it — next we make it run permanently.

## Step 5 — Run it as a Windows service (always on, starts at boot)

We'll use **NSSM**, a tiny tool that runs any program as a Windows service.

```powershell
# download NSSM and put nssm.exe next to the app
Invoke-WebRequest https://nssm.cc/release/nssm-2.24.zip -OutFile $env:TEMP\nssm.zip
Expand-Archive $env:TEMP\nssm.zip -DestinationPath $env:TEMP\nssm -Force
Copy-Item $env:TEMP\nssm\nssm-2.24\win64\nssm.exe C:\nodebook\nssm.exe -Force

# create the service (it reads C:\nodebook\.env automatically)
New-Item -ItemType Directory -Force -Path C:\nodebook\logs | Out-Null
C:\nodebook\nssm.exe install Nodebook "C:\Program Files\nodejs\node.exe" "C:\nodebook\server\index.js"
C:\nodebook\nssm.exe set Nodebook AppDirectory C:\nodebook
C:\nodebook\nssm.exe set Nodebook AppStdout C:\nodebook\logs\out.log
C:\nodebook\nssm.exe set Nodebook AppStderr C:\nodebook\logs\err.log
C:\nodebook\nssm.exe set Nodebook Start SERVICE_AUTO_START
C:\nodebook\nssm.exe start Nodebook

# confirm it's running
Get-Service Nodebook
```

The service now restarts on crash and starts automatically when the server
reboots. Logs are in `C:\nodebook\logs`.

## Step 6 — Open the firewall

Allow inbound connections to port 3000:

```powershell
New-NetFirewallRule -DisplayName "Nodebook 3000" -Direction Inbound `
  -Protocol TCP -LocalPort 3000 -Action Allow
```

(To restrict strictly to your VPN subnet, add `-RemoteAddress 10.0.0.0/24`
with your VPN CIDR.)

## Step 7 — Share it

Give your team the link: `http://<SERVER-LAN-IP>:3000` (e.g.
`http://192.168.10.32:3000`). Each person clicks **Sign up** once; their notes
are private to their account. Off-VPN devices can't reach the address, so it
stays internal.

Optional niceties later: an internal DNS name (e.g. `http://nodebook`) and HTTPS
via a reverse proxy (IIS/Caddy).

---

## Updating to a newer version

```powershell
C:\nodebook\nssm.exe stop Nodebook
# replace the code: download the new ZIP and overwrite C:\nodebook\server and
# C:\nodebook\public and package.json / package-lock.json.
# DO NOT delete C:\nodebook\data (your notes) or C:\nodebook\.env (your config).
cd C:\nodebook
npm ci --omit=dev
C:\nodebook\nssm.exe start Nodebook
```

Your notes live in `C:\nodebook\data\nodebook.sqlite`, untouched by updates.

## Backups

Copy the database file anywhere safe (do it on a schedule if you like):

```powershell
Copy-Item C:\nodebook\data\nodebook.sqlite "C:\nodebook-backups\nodebook-$(Get-Date -Format yyyyMMdd).sqlite"
```

## Service management cheatsheet

```powershell
C:\nodebook\nssm.exe restart Nodebook   # after a config/code change
C:\nodebook\nssm.exe stop Nodebook
C:\nodebook\nssm.exe start Nodebook
Get-Content C:\nodebook\logs\err.log -Tail 40   # see recent errors
C:\nodebook\nssm.exe remove Nodebook confirm     # uninstall the service
```

## Troubleshooting

- **`npm ci` fails building `better-sqlite3`** — it normally downloads a
  prebuilt binary. If it tries to compile and fails, install the build tools:
  `npm install --global --production windows-build-tools` (older) or install
  "Desktop development with C++" from the Visual Studio Build Tools, then retry.
- **Can't reach it from another machine** — confirm the firewall rule (Step 6),
  that you used the server's real LAN IP, and that VPN clients are routed to that
  subnet (you can already RDP to it on the VPN, so they should be).
- **Login doesn't stay** — make sure `.env` has a `JWT_SECRET` and the service
  was restarted after creating it.
