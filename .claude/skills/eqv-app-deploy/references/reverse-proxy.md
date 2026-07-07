# Clean URLs via a reverse proxy (future) + IT ask

Today apps are reached at `http://192.168.10.32:<port>`. To reach them at a clean
address without ports — e.g. `http://apps.eqv/<app>` or `http://<app>.eqv` — put a
single **reverse proxy** in front that routes to each app's local port.

## Why it's not done yet (the blocker isn't the software)

The proxy itself is easy (Caddy = one `.exe` + a few lines, runs as a service, can
do HTTPS). The blocker is that a proxy must own the standard web port **80/443**,
and on this server:

- **Port 80 is already held by Tomcat**, an existing production app.
- **Internal DNS is inconsistent** across client machines, so name-based routing
  isn't reliable yet.

So it needs one **infrastructure decision** (an IT call, since it affects an
existing service and IP allocation), not just app work.

## The two viable options (pick one)

1. **Dedicated IP for the proxy** — assign the server a second internal IP
   (e.g. `192.168.10.33`), run Caddy on it at :80/:443, route by path to each
   app. Tomcat keeps `192.168.10.32:80`. Non-disruptive; needs a reserved IP.
2. **Proxy owns :80** — move Tomcat to another port (e.g. 8080), run Caddy on :80,
   route `/` → Tomcat and `/<app>` → each app. Cleanest, but **changes the
   existing Tomcat app** — needs sign-off + a maintenance window.

Path-based routing (`/<app>`) also needs each app to work under a sub-path (or use
host-based routing, which needs DNS). Build apps reverse-proxy-ready
(build-conventions.md) so this is a config change, not an app rewrite.

## Hand-to-IT summary

> We want a reverse proxy on the app server (`192.168.10.32`) so internal apps
> are reachable at clean URLs without port numbers. It needs to own port 80/443,
> which Tomcat currently uses. Please choose one:
> (a) allocate a spare internal IP reserved for the proxy (outside DHCP), or
> (b) approve moving Tomcat to another port so the proxy can take 80.
> Also, if we want name-based URLs, we need an internal DNS record (or a DNS
> entry pushed to VPN clients) pointing the chosen name(s) at the server.
> The proxy software (Caddy) and per-app routing are quick to set up once one of
> the above is in place.

## Once unblocked (sketch)

Install Caddy as a Windows service; a `Caddyfile` like:

```
:80 {
  handle_path /nodebook/* { reverse_proxy 127.0.0.1:3000 }
  handle_path /<app>/*    { reverse_proxy 127.0.0.1:<port> }
}
```

(or a `site` block per hostname if DNS is used). Then bind each app to
`127.0.0.1` only, and let the proxy be the single front door.
