# Day-2 operations (per app)

Run in **Administrator** PowerShell. `$app`/`$dir` as in deploy-windows.md;
`$nssm` is the nssm.exe path (e.g. `C:\nodebook\nssm.exe`).

## Update to a newer version

```powershell
& $nssm stop $app
# Replace the CODE only: overwrite $dir\server, $dir\public, package.json,
# package-lock.json with the new version. DO NOT touch $dir\data or $dir\.env.
cd $dir
npm ci --omit=dev
& $nssm start $app
Start-Sleep 2; Get-Service $app
```

Data (`$dir\data\...`) and config (`$dir\.env`) are untouched by updates.

## Back up (data is a single file)

```powershell
New-Item -ItemType Directory -Force -Path C:\app-backups | Out-Null
Copy-Item "$dir\data\$app.sqlite" "C:\app-backups\$app-$(Get-Date -Format yyyyMMdd).sqlite"
```

Schedule it with Task Scheduler if the data matters.

## Logs & service control

```powershell
Get-Content "$dir\logs\err.log" -Tail 40    # recent errors
Get-Content "$dir\logs\out.log" -Tail 40
& $nssm restart $app
& $nssm stop $app
& $nssm start $app
& $nssm remove $app confirm                 # uninstall the service
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Administrator access is needed to install a service` | Reopen PowerShell **as Administrator**. |
| `Can't open service! ... does not exist` after a failed install | The install didn't run (not elevated). Elevate, `& $nssm remove $app confirm`, redo. |
| `npm ci` tries to compile a native module and fails | Install the VS C++ Build Tools ("Desktop development with C++"), retry. |
| nssm.cc returns 503 on download | Retry, or reuse an existing `nssm.exe` on the server. |
| Reachable on the server but not from other machines | Add the firewall rule (deploy-windows.md step 6); confirm the client is on VPN. |
| Login doesn't persist across restarts | Ensure the app's secret (e.g. `JWT_SECRET`) is set in `.env` and stable, then restart the service. |
| Port already in use on start | Another app/instance holds the port — pick a free one (registry) or stop the other. |
