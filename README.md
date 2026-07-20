# Ae.DirectChat
A peer to peer chat application built with WebRTC.

## Features
* Self-hosted signalling channel over WebSockets, served by the same ASP.NET Core app as the UI
* Customisation options for audio
* Stereo audio on Firefox
* Video support

## Running it
```
cp .env.example .env   # optional, only if you want to change the port
docker compose build
docker compose up
```
Then open `http://localhost:8080` (or whatever `PORT` you set in `.env`).

### Config
- **`.env`** (copy from `.env.example`, gitignored): currently just `PORT`, the host port to publish. The container always listens on 8080 internally.
- **GeoIP (optional)**: set `MAXMIND_ACCOUNT_ID` and `MAXMIND_LICENSE_KEY` in `.env` (get a free key at https://www.maxmind.com/en/accounts/current/license-key) to enable the attendee location/flag feature. `docker-compose.yml` runs MaxMind's official `geoipupdate` sidecar, which downloads `GeoLite2-City.mmdb` into `./geoip` (gitignored) and refreshes it every 30 days; the `chat` service mounts that same directory read-only via `GEOIP_DB_PATH`. Without the keys set, `geoipupdate` has nothing to do and the app just skips sending `location` messages — everything else still works.
- **HTTPS**: the container itself only serves plain HTTP. That's fine for `localhost`, but browsers only allow camera/mic access (`getUserMedia`) and `crypto.randomUUID()` in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts): `localhost` is exempted, a real hostname is not. For an actual deployment, put a reverse proxy (Caddy, nginx, Traefik, etc.) in front doing TLS termination and forward to port 8080; this repo doesn't include one since the right choice depends on your existing infra.

## Development
The signalling server and static file host are one ASP.NET Core app; `dotnet run` serves both. `ts/*.ts` is the real frontend source; it's compiled to `wwwroot/js/*.js` (plain ES modules, no bundler) automatically as part of `dotnet build`/`publish` via the `Microsoft.TypeScript.MSBuild` NuGet package, which requires Node to be on `PATH` at build time (the Dockerfile installs it in the build stage only; the published runtime image has no Node dependency).
