# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors working
in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **Beatbot** pool cleaning robots
(AquaSense, Sora…) and their cleaning base station. It started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js).

Cloud only (`"transports": ["cloud"]`): the robots are reached through the Beatbot cloud
"open API" that Beatbot publishes for Home Assistant. The reference implementation is
Beatbot's own Python client,
[beatbot-cloud-python](https://github.com/Beatbot-Robotics/beatbot-cloud-python): URLs,
paths, capability keys, status and error tables are ported from it. Check it first when the
cloud changes.

Gladys 5.1+ adds scene triggers (status changed, cleaning finished, fault), scene actions
(start, pause, return to base, cleaning mode) and the "Pool robot" widget.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/service.test.js            # one file
node --test --test-name-pattern "4001"      # one test by name
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI runs `format:check`, `lint`, `test` (Node 22 and 24); pull requests also run the store
checks and build the Docker image. Releases: **Actions → Release** only (bumps `package.json`,
manifest `version` + `docker_image`, rolls `CHANGELOG.md`, re-runs Prettier, tags, builds the
multi-arch image, publishes the GitHub Release).

## Architecture

```
index.js                      SDK wiring only: handlers registered before connect()
src/config.js                 DEFAULT_CONFIG (mirrors the manifest defaults) + off-schema token keys
src/service.js                the orchestrator: sync, event handling, commands, connection status
src/beatbot/const.js          cloud URLs, regions, capability keys (from beatbot-cloud-python)
src/beatbot/protocol.js       status / error tables, Gladys state mapping, labels en/fr
src/beatbot/oauth.js          PKCE, authorize URL, code exchange, refresh, JWT claims
src/beatbot/account.js        the linked account: tokens in memory + persisted via setConfig
src/beatbot/client.js         REST client (envelope, 401 -> one refresh + retry), device model
src/beatbot/eventStream.js    account WebSocket: reconnect/backoff, dedup, close codes 4001-4003
src/devices/poolRobot.js      Gladys device payload, states, command translation
src/capabilities/triggers.js  scene triggers (transition tracker)
src/capabilities/scenes.js    scene action handlers
src/capabilities/widget.js    "Pool robot" dashboard widget
src/capabilities/actions.js   Configuration screen buttons (test_connection)
docs/{en,fr,de,es}.md         user documentation, re-hosted by Gladys (keep all four in sync)
.github/scripts/changelog-release.mjs   rolls CHANGELOG.md for the Release workflow
```

### Invariants worth knowing

- **Features follow the advertised capabilities.** A command is offered only when discovery
  lists its `interfaceInfo` without `nonControllable`; never infer one from the category.
- **The region is never guessed.** It comes from the `region` claim of the access token (or
  the Region field). Calling another region routes the account to the wrong backend.
- **Tokens: memory wins.** The refresh token may be rotated; an older copy coming back from
  the config must not replace the one in memory (`account.load`). Tokens live in off-schema
  config keys (`TOKEN_KEYS`), written with `gladys.setConfig`. Never log them.
- **One refresh at a time** (`account.refresh` is single-flight); a 401 from REST or a 4001
  close of the stream refreshes once, then the error stands and the user is asked to
  connect again.
- **Close 4002** means another connection of the same account replaced ours (two clients on
  one account): the stream stops, the periodic full refresh keeps the states right.
- **Scene events fire on transitions only**; the first look at a device is a baseline (a
  restart never fires "cleaning finished"). Never fire an event from a received action.
- **No Gladys polling**: `should_poll: false`; the stream plus the `refresh_interval` timer
  keep the states.
- **Every feature declares `min`/`max`.** The cleaning mode is a `text`/`select` whose values
  are the labels (the cloud sets the mode by label).
- **Keys are forever**: external ids (`beatbot:<deviceId>[:<feature>]`), config, action,
  trigger, scene action and widget keys are stored by users. Never rename one.

## Rules

- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow.** Never edit `version` in `package.json` or the
  manifest, nor the `docker_image` tag, by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a
  version heading.
- **Manifest.** Texts are `{ "en", "fr", "de", "es" }` objects (`label`, `description`,
  `placeholder`). The catalog `description` holds 10 to 100 characters per language. `scene_triggers`,
  `scene_actions` and `widgets` require `gladys_version >= 5.1.0`. `test/manifest.test.js`
  ties the manifest to the code (defaults, handlers, trigger options): change both together.
- **User-facing text** is `{ en, fr, de, es }` (English, French, German, Spanish), and
  `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md` stay in sync.
- **Tests never touch the network**: `test/helpers/fakeBeatbot.js` fakes the cloud (fetch,
  OAuth, WebSocket), `test/helpers/fakeGladys.js` the SDK.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English.
