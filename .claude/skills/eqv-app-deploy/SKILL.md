---
name: eqv-app-deploy
description: >-
  Playbook for building and deploying internal web apps onto EQV's shared
  Windows app server (Windows Server 2022 at 192.168.10.32, reachable over the
  WireGuard VPN and office LAN). Use when creating a NEW internal EQV app, or
  deploying/updating one on the app server, so it follows the pattern already in
  place with minimal setup. Covers the required app conventions (.env config,
  unique port, health check, own login), getting code onto the server, running
  it as an always-on Windows service via NSSM, and day-2 operations. Generic —
  not specific to any single app.
---

# EQV internal app — build & deploy

A reusable playbook for shipping an internal web app to EQV's shared Windows app
server, reusing infrastructure that is **already set up** (Node runtime, the
NSSM service manager, VPN network access). Follow the same shape every time and a
new app goes live in minutes with almost no new setup.

## Server environment (already in place)

- **Host:** Windows Server 2022 (Hyper-V VM), single LAN address **`192.168.10.32`**.
- **Access:** reachable by **WireGuard VPN** clients (routed into `192.168.10.0/24`)
  and the office LAN. Not exposed to the public internet, so it's internal-only.
- **Node.js LTS** is installed (`C:\Program Files\nodejs\node.exe`).
- **NSSM** (runs any program as a Windows service) is on the box — reuse
  `C:\nodebook\nssm.exe`, or download from nssm.cc.
- **One app = one folder + one Windows service + one port.** Each app lives in
  `C:\<app>`, runs as its own NSSM service, and listens on its own port. Users
  reach it at `http://192.168.10.32:<port>`.
- Full facts + the **port registry** (which ports are taken — always pick a free
  one and record it): [`references/server-environment.md`](references/server-environment.md).

## Deploy a new app — checklist

1. **Make the app conform** to the conventions in
   [`references/build-conventions.md`](references/build-conventions.md):
   `.env` config, `HOST=0.0.0.0`, a unique `PORT`, data in a stable folder, a
   `GET /healthz`, and its **own authentication**.
2. **Pick a free port** from [`references/server-environment.md`](references/server-environment.md)
   and add your app to the registry.
3. **Deploy** by following [`references/deploy-windows.md`](references/deploy-windows.md):
   copy code to `C:\<app>`, `npm ci --omit=dev`, create `.env`, test-run, then
   install the NSSM service and verify.
4. **Share** the link: `http://192.168.10.32:<port>`.

Day-2 operations (update, back up, logs, troubleshooting):
[`references/operations.md`](references/operations.md).

## Why the conventions matter

Every app that follows the same conventions deploys, updates, and is operated the
*same way* — so future sessions don't re-derive infrastructure:

- **Config in a `.env` file** in the app root (real env vars still override); no
  secrets hardcoded.
- **Bind `HOST=0.0.0.0`** and listen on the app's **assigned port**.
- **Data lives outside the code** (e.g. `C:\<app>\data\`) so updates never touch it.
- **`GET /healthz` → 200** for quick checks and service health.
- **Each app ships its own login.** Network access (VPN/LAN) is the outer gate,
  not the only one.
- Be **reverse-proxy ready** (honor `X-Forwarded-Proto`, secure cookies behind
  TLS) so clean URLs can be layered on later without app changes.

## Gotchas (learned deploying the first app)

- Installing/altering a service needs **PowerShell running as Administrator**.
- `npm ci` pulls **prebuilt** native binaries on Windows (e.g. better-sqlite3) —
  no compiler needed. If it tries to compile, install the VS C++ Build Tools.
- nssm.cc sometimes returns **503** — retry, or reuse an `nssm.exe` already on the
  server.
- The first interactive `node` run pops a **Windows Firewall** prompt; approving
  it usually makes the port reachable without a separate firewall rule.

## Future: clean URLs without ports

Port-per-app is today's norm. To reach apps at `http://host/appname` (no port), a
**reverse proxy** (e.g. Caddy) is the plan — but port 80 is held by Tomcat and
internal DNS is inconsistent, so it needs an infrastructure decision (a spare
internal IP for the proxy, or moving Tomcat off 80). Details + a hand-to-IT
summary: [`references/reverse-proxy.md`](references/reverse-proxy.md).
