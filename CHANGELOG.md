# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release workflow
moves that section under the version it ships, and the section becomes the notes
of the version's GitHub Release.

## [Unreleased]

## [1.2.2] - 2026-10-17

### Changed

- Documentation: explain the "Whitelabel Error Page … status=400" shown by the
  Beatbot page after sign-in (Beatbot does not accept the Gladys return address
  yet, request open at Beatbot), and how to get the sign-in page back.

## [1.2.1] - 2026-10-16

### Changed

- The integration logs show when Connect is clicked and why a sign-in fails.
- Configuration screen and documentation: say that `home-assistant` is only the
  name of Beatbot's public client (Home Assistant is not needed), and what to do
  when Connect opens nothing (pop-up blocked by the browser).

## [1.2.0] - 2026-10-13

### Added

- German and Spanish translations (configuration screen, messages, widgets,
  documentation).
- Scene trigger "Pool robot fault": `label_de` and `label_es` variables (the fault in
  German and Spanish).

### Fixed

- The English documentation names the Gladys screens as the Gladys interface does.

## [1.1.0] - 2026-10-12

### Added

- "Pool robot" widget: a **Cleaning mode** button opens a form listing the
  modes of the robot, when the robot lets its mode be changed.

### Fixed

- The release script no longer takes the mention of the Unreleased heading in
  the changelog intro for the section itself: the 1.0.0 notes were left empty.

### Changed

- `@gladysassistant/integration-sdk` updated to 0.15.0.
- Requires Gladys 5.2.0 (the first release relaying the values of a widget
  button form).

## [1.0.0] - 2026-10-12

### Added

- Beatbot account sign-in from the Configuration screen (OAuth2 with PKCE: the
  password never goes through Gladys), with automatic region detection (Europe,
  North America, Mainland China) and a manual override.
- Every pool robot and cleaning base station of the account appears in Gladys:
  state, cleaning on/off, return to base, battery, charging, cleaning mode,
  child lock and "do not disturb", each one only when the robot offers it.
- Real-time updates through the Beatbot event stream, with a periodic full
  refresh to catch what a network outage missed.
- Cloud / unreachable badge on every robot.
- Scene triggers: robot status changed, cleaning finished (with its duration),
  robot fault (stuck, basket full, motor fault…).
- Scene actions: start, pause, return to base, set the cleaning mode.
- "Pool robot" dashboard widget: battery, status, fault, link, mode, last
  cleaning, and Start / Pause / Return buttons.
- "Test the connection" button in the Configuration screen.
- CI (format, lint, tests on Node 22 and 24, store checks, Docker build), UI
  release workflow, GitHub Releases, Dependabot.
- `SECURITY.md`, `CLAUDE.md` and the user documentation in English and French.

[Unreleased]: https://github.com/prohand/gladys-beatbot/compare/v1.2.2...HEAD
[1.2.2]: https://github.com/prohand/gladys-beatbot/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/prohand/gladys-beatbot/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/prohand/gladys-beatbot/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/prohand/gladys-beatbot/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/prohand/gladys-beatbot/releases/tag/v1.0.0
