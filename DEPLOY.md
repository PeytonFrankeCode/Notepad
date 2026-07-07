# Deploying Notepad on your own server (WireGuard, step by step)

This walks you through hosting Notepad on your Linux server so that **only
people connected to your WireGuard VPN** can reach it. No prior experience
assumed. Commands are for **Ubuntu/Debian**; other distros differ only in the
install step.

Legend: run lines starting with `$` on the **server** (over SSH), and lines
starting with `#` are comments.

---

## Overview (what we're going to do)

1. Get the code onto the server.
2. Install Docker (one time).
3. Set a secret and choose which network address to serve on.
4. Start the app.
5. Test it from a VPN-connected laptop.
6. (Optional) Add HTTPS.

---

## Step 1 — Connect to the server and get the code

SSH into your server, then clone the repo into `/opt/notepad`:

```bash
$ sudo mkdir -p /opt/notepad
$ sudo chown "$USER" /opt/notepad
$ git clone <YOUR_REPO_URL> /opt/notepad
$ cd /opt/notepad
$ git checkout claude/notetaking-daily-backlinks-vzf64y
```

## Step 2 — Find your WireGuard address

Notepad should listen on the server's **WireGuard IP** so it's only reachable
through the VPN. Find it:

```bash
$ sudo wg show                 # shows your WireGuard interface (often wg0)
$ ip -4 addr show wg0          # the "inet" line, e.g. 10.0.0.1/24
```

Note that address (example: `10.0.0.1`). That's your **VPN_IP** below.

## Step 3 — Install Docker (one time)

```bash
$ curl -fsSL https://get.docker.com | sudo sh
$ sudo usermod -aG docker "$USER"      # lets you run docker without sudo
$ newgrp docker                        # apply the group now (or log out/in)
$ docker version                       # confirm it prints Client + Server
```

## Step 4 — Configure the app

Create the `.env` file with a strong session secret:

```bash
$ cp .env.example .env
$ echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env   # appends a random secret
```

Now open `docker-compose.yml` and set the `ports:` line to your **VPN_IP** so
the app is only exposed on the VPN:

```yaml
    ports:
      - "10.0.0.1:3000:3000"      # <-- replace 10.0.0.1 with YOUR VPN_IP
```

(Leaving it as `127.0.0.1:3000:3000` makes it reachable only from the server
itself — useful if you'll put a reverse proxy in front later.)

## Step 5 — Start it

```bash
$ docker compose up -d           # builds and starts in the background
$ docker compose ps              # STATUS should say "Up (healthy)"
$ docker compose logs -f         # watch logs; Ctrl-C to stop watching
```

Quick local check on the server:

```bash
$ curl http://10.0.0.1:3000/healthz     # expect: {"ok":true}
```

## Step 6 — Use it from a VPN client

On a laptop/phone **connected to the WireGuard VPN**, open:

```
http://10.0.0.1:3000
```

Click **Sign up**, create your account, and you're in. Try it from a device
**not** on the VPN — it should fail to connect, confirming it's private.

---

## Optional — Add HTTPS

Plain HTTP is fine inside a VPN, but HTTPS is nicer (and required if you later
expose it more widely). Easiest path is [Caddy](https://caddyserver.com) or
nginx in front — see [`deploy/nginx.conf.example`](deploy/nginx.conf.example).
Set the app to listen on `127.0.0.1` and let the proxy handle TLS + the VPN
subnet allowlist. The app auto-enables Secure cookies when it sees HTTPS.

---

## Day-to-day operations

```bash
# View logs
$ docker compose logs -f

# Restart / stop
$ docker compose restart
$ docker compose down            # stop (data is kept in the volume)

# Update to the latest code
$ git pull
$ docker compose up -d --build

# Back up your notes (all data is in the named volume)
$ docker run --rm -v notepad_notepad-data:/data -v "$PWD":/backup busybox \
    tar czf /backup/notepad-backup.tar.gz -C /data .
```

Your database is a single SQLite file inside the `notepad-data` Docker volume.
Backing up that `.tar.gz` (or the volume) preserves everything.

---

## Prefer not to use Docker?

You can run it directly with Node instead and manage it via systemd — see the
"Run with Node" section of the [README](README.md) and
[`deploy/notepad.service`](deploy/notepad.service).

---

## Troubleshooting

- **`docker: permission denied`** — you skipped `newgrp docker` (or need to log
  out/in) after `usermod -aG docker`.
- **Can't reach it from a VPN client** — confirm the client is connected
  (`wg show` on the client), that you used the server's **VPN_IP** in
  `docker-compose.yml`, and that no host firewall blocks the port on the VPN
  interface (`sudo ufw allow from 10.0.0.0/24 to any port 3000` for ufw).
- **Login doesn't "stick"** — make sure `JWT_SECRET` is set in `.env` (so it's
  stable across restarts).
- **`STATUS` not healthy** — `docker compose logs` will show the error.
