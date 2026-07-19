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
- **GeoIP (optional)**: mount a MaxMind GeoLite2-City database at `./geoip/GeoLite2-City.mmdb` (gitignored; `docker-compose.yml` already mounts `./geoip` read-only, pointed at by `GEOIP_DB_PATH`) to enable the attendee location/flag feature. Without it, everything else still works, it just skips sending `location` messages.
- **HTTPS**: the container itself only serves plain HTTP. That's fine for `localhost`, but browsers only allow camera/mic access (`getUserMedia`) and `crypto.randomUUID()` in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts): `localhost` is exempted, a real hostname is not. For an actual deployment, put a reverse proxy (Caddy, nginx, Traefik, etc.) in front doing TLS termination and forward to port 8080; this repo doesn't include one since the right choice depends on your existing infra.

## Development
The signalling server and static file host are one ASP.NET Core app; `dotnet run` serves both. `ts/*.ts` is the real frontend source; it's compiled to `wwwroot/js/*.js` (plain ES modules, no bundler) automatically as part of `dotnet build`/`publish` via the `Microsoft.TypeScript.MSBuild` NuGet package, which requires Node to be on `PATH` at build time (the Dockerfile installs it in the build stage only; the published runtime image has no Node dependency).
