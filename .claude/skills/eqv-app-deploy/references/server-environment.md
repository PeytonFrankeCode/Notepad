# EQV app server — environment & port registry

## The server

| Fact | Value |
| --- | --- |
| OS | Windows Server 2022 (Hyper-V VM) |
| Address | `192.168.10.32` (single LAN NIC) |
| Admin access | Remote Desktop (RDP), as an administrator account |
| Reachable from | WireGuard VPN clients (routed to `192.168.10.0/24`) + office LAN |
| Public internet | No — internal only |
| Node.js | LTS installed at `C:\Program Files\nodejs\node.exe` |
| Service manager | NSSM (e.g. `C:\nodebook\nssm.exe`; else nssm.cc) |
| App layout | one folder `C:\<app>`, one NSSM service, one port each |
| App URL | `http://192.168.10.32:<port>` |

There is **no reverse proxy yet** and **DNS is inconsistent** across client
machines, so apps are reached by IP + port. See `reverse-proxy.md` for the plan
to change that.

## How access works (why this is "VPN-only enough")

The server only has a **private** address, so it is not reachable from the
public internet. Remote staff reach it because the **WireGuard VPN routes them
into the `192.168.10.0/24` network** (the same way they already RDP to it).
People in the office reach it directly on the LAN. So: VPN or office = access;
everyone else = no route. Each app still ships its own login as a second layer.

## Port registry — KEEP THIS UPDATED

Every app must use a **unique** port. Before deploying, confirm the port is free
on the server:

```powershell
Get-NetTCPConnection -State Listen -LocalPort <port> -ErrorAction SilentlyContinue
```

(No output = free.) Then add the app here.

| Port | App | Notes |
| ---- | --- | ----- |
| 80   | Tomcat | pre-existing app; **do not disturb** |
| 3000 | Nodebook | first app deployed with this playbook |
| 3001 | *(free)* | suggested next |
| 3002 | *(free)* | |
| 8080 | *(free)* | |

Convention: use `3000`, `3001`, `3002`, … for new apps. Avoid 80 (Tomcat) and any
port shown as listening by the check above.
