# Beatbot for Gladys Assistant

External integration connecting [Gladys Assistant](https://gladysassistant.com) to
**Beatbot pool cleaning robots** (AquaSense, Sora…) and their cleaning base station,
through the Beatbot cloud. Built on the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js) and the
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

- **Transport: cloud only** (`"transports": ["cloud"]`) — Beatbot robots have no local API.
- **Requires Gladys ≥ 5.3.0** (scene triggers, scene actions, dashboard widget, the form of
  its Cleaning mode button, and the catalog keywords of the manifest).
- User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
  [Español](docs/es.md).

## Features

| Surface               | What it does                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account               | "Connect" button (OAuth2 + PKCE, password never seen by Gladys), automatic region (EU / NA / CN), token refresh                                                       |
| Devices               | One device per robot / station: state, cleaning on/off, return to base, battery, charging, cleaning mode, child lock, do not disturb — only what the robot advertises |
| Real time             | Beatbot account WebSocket (push), reconnect with backoff, plus a periodic full refresh                                                                                |
| Transport badge       | `cloud` when the robot is online, `unreachable` otherwise                                                                                                             |
| Scene triggers        | `status_changed`, `cleaning_finished` (with its duration), `error_raised` (stuck, basket full, motor fault…)                                                          |
| Scene actions         | `start_cleaning`, `pause_cleaning`, `return_to_base`, `set_cleaning_mode` (output `sent`)                                                                             |
| Dashboard widget      | `pool_robot`: live battery, status, fault, link, mode, last cleaning, Start / Pause / Return buttons, Cleaning mode form (the robot's own modes)                      |
| Configuration actions | `test_connection`: lists the robots of the account with their status                                                                                                  |

## How it talks to Beatbot

Beatbot publishes an "open API" for home automation, used by its own Home Assistant
integration. This integration is a JavaScript port of Beatbot's official Python client,
[beatbot-cloud-python](https://github.com/Beatbot-Robotics/beatbot-cloud-python)
(Apache-2.0):

| What               | Where                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------- |
| OAuth2 (PKCE)      | `https://oauth.beatbot.com/oauth2/authorize` and `/oauth2/token`, scope `device:info`   |
| REST, per region   | `https://{eu,na,cn}-iot.beatbot.com/openapi/v1/ha` (devices, `/state`, `/{id}/actions`) |
| Events (WebSocket) | `wss://{region}-iot.beatbot.com/openapi/v1/ha/ws`                                       |

The OAuth client ID defaults to the public one Beatbot ships in its library
(`home-assistant`) and can be changed in the configuration. Whether Beatbot's authorization
server accepts the Gladys redirect URI for that client is decided by Beatbot: if the sign-in
page refuses it, ask Beatbot for a client ID for Gladys (see the user documentation).

## Project structure

```
.
├─ index.js                          # SDK wiring only (handlers registered before connect)
├─ src/
│  ├─ service.js                     # orchestrator: sync, events, commands, connection status
│  ├─ config.js                      # DEFAULT_CONFIG + off-schema token keys
│  ├─ beatbot/                       # Beatbot cloud client (no Gladys code)
│  │  ├─ const.js                    #   URLs, regions, capability keys
│  │  ├─ protocol.js                 #   status / error tables, Gladys mapping, labels
│  │  ├─ oauth.js                    #   PKCE, code exchange, refresh
│  │  ├─ account.js                  #   linked account, token storage
│  │  ├─ client.js                   #   REST client + device model
│  │  └─ eventStream.js              #   real-time WebSocket
│  ├─ devices/poolRobot.js           # Gladys device, states, commands
│  └─ capabilities/                  # Gladys 5.1: triggers, scene actions, widget, actions
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, no network (fake cloud + fake SDK)
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, non-root, read-only rootfs ready
├─ CHANGELOG.md · SECURITY.md · CLAUDE.md
└─ .github/                          # CI, release, build, GitHub releases, Dependabot
```

## Development

```bash
npm install
npm test               # node --test
npm run lint           # ESLint
npm run format:check   # Prettier (CI gate) — npm run format to fix
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="beatbot" \
LOG_LEVEL=debug \
npm start
```

## Workflows

The same workflows as [gladys-devmel](https://github.com/prohand/gladys-devmel):

| Workflow                                                     | When                                      | What                                                                               |
| ------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| [`ci.yml`](.github/workflows/ci.yml)                         | push on `main`, pull requests             | Prettier, ESLint, tests on Node 22 and 24; PRs: store checks + Docker build        |
| [`release.yml`](.github/workflows/release.yml)               | Actions → Release → patch / minor / major | bump `package.json` + manifest, roll `CHANGELOG.md`, tag, build, GitHub Release    |
| [`build.yml`](.github/workflows/build.yml)                   | `v*` tag, manual run, called by release   | multi-arch image `linux/amd64` + `linux/arm64` to `ghcr.io/prohand/gladys-beatbot` |
| [`github-release.yml`](.github/workflows/github-release.yml) | push on `main`, manual, called by release | one GitHub Release per `vX.Y.Z` tag, notes from `CHANGELOG.md`                     |
| [`dependabot.yml`](.github/dependabot.yml)                   | weekly / monthly                          | npm, GitHub Actions and Docker base image updates                                  |

## Publishing checklist

1. Add the GitHub topic **`gladys-assistant-integration`** to the repository.
2. Turn on **Private vulnerability reporting** (Settings → Security), see
   [SECURITY.md](SECURITY.md).
3. Make the `ghcr.io/prohand/gladys-beatbot` package public after the first build.
4. Describe the changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md), then
   **Actions → Release → Run workflow**. The repository starts at `0.0.0`: pick **major**
   for the first release, which ships `1.0.0`.

Until that first release, the "Store admission checks" job of pull requests fails on
purpose: the manifest points at an image tag that does not exist yet.

## License

Apache-2.0. Beatbot is a trademark of its owner; this project is not affiliated with
Beatbot.
