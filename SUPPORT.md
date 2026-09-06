# Support policy

Policy effective **5 September 2026**.

## Supported versions

| Release line | Maintenance commitment | Through (inclusive) |
| --- | --- | --- |
| Latest 8.x minor | Bug fixes and security fixes | 5 September 2027 |
| 7.1.x | Security backports | 5 March 2027 |

When a new 8.x minor ships, upgrade to that minor to continue receiving bug and security fixes. The 7.1.x line receives security backports during its stated window.

## Upstream compatibility

For every new stable major of React, React Router or Vite, we will publish a **supported**, **investigating** or **unsupported** statement within **30 days** of its release. We will publish that statement in GitHub Discussions or Releases and link to the tested combinations where applicable. A permissive peer dependency range alone is not a support statement.

## Response commitments

- We will provide a human acknowledgment of a GitHub issue within **five business days**.
- We will provide a human acknowledgment of a security report within **two business days**. Follow the [security reporting policy](./SECURITY.md) to report privately.

These are acknowledgment targets; the time needed to investigate and resolve a report depends on its scope. Business days are Monday through Friday, excluding public holidays observed by the responding maintainer.

Issues explicitly labeled `needs-reproduction` receive an inactivity reminder after 30 days and may be closed 14 days later. Issues labeled `bug`, `confirmed` or `enhancement`, and all pull requests, are exempt. Add the requested reproduction and reopen the issue, or ask a maintainer to reopen it in a comment.

## Deprecations and breaking changes

We will announce deprecations at least **90 days** and **two minor releases** before removal, and remove deprecated APIs only in a **major release**. Both notice periods must be satisfied. Raising the package's Node.js requirement counts as a breaking change and requires a major release.

## Maintenance updates

We will publish a short maintenance note **each month**, beginning in **September 2026**, in [GitHub Discussions](https://github.com/Lomray-Software/vite-ssr-boost/discussions) or [Releases](https://github.com/Lomray-Software/vite-ssr-boost/releases). Each note will cover maintenance activity and compatibility status, including months with no release.
