# Deploying Volt to the `games` Ubuntu server

Same shape as the chat app: build a full-snapshot tarball on Windows, extract it
over `~/volt-server` on the server, `npm install`, restart the service.

## First-time setup (on the server)

```bash
mkdir -p ~/volt-server
# ...extract the first tarball here (see below), then:
cd ~/volt-server
npm install --omit=dev
cp config.example.json config.json
nano config.json          # set "masterKey" to your owner secret; pick a port

sudo cp deploy/volt.service /etc/systemd/system/volt.service
sudo systemctl daemon-reload
sudo systemctl enable --now volt
journalctl -u volt -f     # watch it start
```

On first boot the server hashes `masterKey` and rewrites `config.json` (replacing
the plaintext with `masterKeyHash`) and adds a random `sessionSecret`.
`config.json` and `data/` are **gitignored and survive updates** — never ship
them in a tarball.

## playit.gg tunnel

Port 3200 is free on `games` (3000 = chat, 8080 = AMP, 8090 = chat http).
Add a playit TCP tunnel `-> 127.0.0.1:3200`. Force an **IPv4** allocation like
you did for the chat http tunnel. Then Volt is at
`http://<your-tunnel-host>:<port>/`.

- students: `/`
- teachers: `/admin`
- you (owner): `/owner`  ← master key from `config.json`

If you want HTTPS, point a DuckDNS subdomain at the playit IPv4 and reuse the
`setup-letsencrypt.sh` certbot-DNS-01 approach; then set `"certs"` handling in
front of Volt with a small reverse proxy, or run Volt behind the same nginx/caddy
you'd use for the chat app. (Volt itself is plain HTTP — put TLS in front.)

## Updating (every release)

On Windows:

```bash
cd C:\Users\hyrum\volt\server
bash make-tarball.sh          # -> volt-server.tgz  (full snapshot, no diffs)
```

Copy `volt-server.tgz` to the server, then:

```bash
cd ~/volt-server
tar xzf ~/volt-server.tgz --strip-components=1
npm install --omit=dev
sudo systemctl restart volt
```

`config.json` and `data/` are not in the tarball, so they're untouched.
