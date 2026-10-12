# Security policy

## Supported versions

Only the latest release of the Beatbot integration receives security fixes.
Update the integration from Gladys before reporting a problem.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-beatbot](https://github.com/prohand/gladys-beatbot/security), then
**Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, account ids and addresses first).

You should get a first answer within 7 days. The fix ships as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes, in
particular the handling of the Beatbot OAuth tokens (sign-in, refresh, storage
in the Gladys configuration) and of the data received from the Beatbot cloud.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Beatbot cloud, apps and robots (report those to Beatbot), and the other
third-party services the integration talks to.

## How the integration handles your account

- Your Beatbot password is typed on the Beatbot sign-in page only: it never
  goes through Gladys nor this integration.
- The integration keeps the OAuth tokens Beatbot gives it in the Gladys
  configuration, under keys that are never shown in the interface nor sent to
  the browser. It never writes them to the logs.
- It only talks to the Beatbot cloud over HTTPS and secure WebSocket
  (`oauth.beatbot.com` and the `*-iot.beatbot.com` server of your region).
- To cut its access at any time, revoke the authorization from your Beatbot
  account, or uninstall the integration.

## Good practices for users

- Keep Gladys and the integration up to date.
- Do not paste integration logs publicly without reading them first.
