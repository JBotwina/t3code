# T2 Code — fork notes

This repo is a fork of T3 Code that installs **side by side** with an upstream
build. Everything that makes the OS treat the two as different applications is
defined once, in `packages/shared/src/forkBrand.ts`.

## What differs from upstream

| Thing             | Upstream                       | This fork                      |
| ----------------- | ------------------------------ | ------------------------------ |
| Product name      | `T3 Code (Alpha)`              | `T2 Code`                      |
| Bundle id         | `com.t3tools.t3code`           | `io.jamesbotwina.t2code`       |
| Deep-link scheme  | `t3code://`                    | `t2code://`                    |
| Electron userData | `…/Application Support/t3code` | `…/Application Support/t2code` |
| Server home       | `~/.t3`                        | `~/.t2`                        |
| Icon              | `assets/prod` (black)          | `assets/dev` (blueprint)       |

State is fully isolated: T2 Code never reads or writes `~/.t3`. Projects,
threads, settings, and pairing start empty. To seed them once from the real
app, copy while **both apps are closed**:

    cp -R ~/.t3 ~/.t2

Product copy elsewhere in the UI still says "T3 Code". That is deliberate —
rewriting prose would conflict on every upstream change and buys nothing.

## Keeping merges cheap

Branding call sites are one line each and reference `FORK_BRAND.*`, so a merge
only conflicts if upstream edits that exact line. The full list:

- `apps/desktop/package.json` — `productName`
- `apps/desktop/src/app/DesktopEnvironment.ts` — app name, userData dir, app user model id, WM class
- `apps/desktop/src/app/DesktopStatePaths.ts` — `~/.t2`
- `apps/desktop/src/app/DesktopEarlyElectronStartup.ts` — WM class
- `apps/desktop/src/app/DesktopLinuxUrlHandler.ts` — `.desktop` entry name
- `apps/desktop/src/electron/ElectronProtocol.ts` — schemes
- `apps/web/src/branding.ts` — fallback display name
- `apps/web/index.html` — `<title>` and splash alt text
- `scripts/build-desktop-artifact.ts` — appId, artifact name, product name, protocols, Linux exec name, icon assets
- `scripts/lib/brand-assets.ts` — web favicon brand

Tests reference `FORK_BRAND` too, so a future rename touches only the constant.

### Merge workflow

    git remote add upstream https://github.com/pingdotgg/t3code   # once
    git fetch upstream
    git merge upstream/main

Conflicts, if any, will be in the files listed above. Resolve by keeping the
`FORK_BRAND.*` reference and taking upstream's surrounding code.

Feature work in this fork (e.g. read-aloud) lives in new files wherever
possible for the same reason — new files never conflict.

## Building the app

    pnpm dist:desktop:dmg:arm64

The unsigned `.dmg` lands in `dist/`. Auto-update stays inert unless
`T3CODE_DESKTOP_UPDATE_REPOSITORY` is set, so the fork will never replace
itself with an upstream release.
