## [1.3.0](https://github.com/tux86/awssesh/compare/v1.2.3...v1.3.0) (2026-06-11)

### ⚠ BREAKING CHANGES

* the web UI is removed and Homebrew/binary distribution is
replaced by npm (npx awssesh / npm i -g awssesh).

### Features

* distribute as a CLI-only npm package ([5307746](https://github.com/tux86/awssesh/commit/5307746d89817027319176b4da3fd7a60f6599c7))

### Refactoring

* **aws:** replace Bun APIs with node:fs/promises and node:child_process ([ffcc9c0](https://github.com/tux86/awssesh/commit/ffcc9c03f57059a9f146f3d0e999dde64e2c6fdf))
* **cli:** remove web UI layer and toolchain ([d6f3f53](https://github.com/tux86/awssesh/commit/d6f3f53eb374f656bf2e3d8b11b55117eaa86bdb))
* drop dead web eslint block, fix CONTRIBUTING, harden ~/.aws writes ([b15cb3c](https://github.com/tux86/awssesh/commit/b15cb3c01dc8de09f6dc9ae591d465af0101dcdf))

## [1.4.0](https://github.com/tux86/awssesh/compare/v1.3.1...v1.4.0) (2026-06-11)


### Features

* **aws:** add console signin URL and export-block builders ([e41f80a](https://github.com/tux86/awssesh/commit/e41f80aa7fa9793c76cf00a49c50e99cd6d4a66f))
* **cli:** add daemon entry, detached spawn, and socket client ([5b4bfe9](https://github.com/tux86/awssesh/commit/5b4bfe945c6b4687cf376fbfdaa93cae5195e98b))
* **cli:** add daemon runtime paths and single-instance detection ([b496390](https://github.com/tux86/awssesh/commit/b496390e145e2fcce16178a028008a3682157348))
* **cli:** add daemon wire protocol and ndjson codec ([673f595](https://github.com/tux86/awssesh/commit/673f595a7b1ca3d90af87e56d9b3186a4dfe2817))
* **cli:** add expiry-aware scheduler decision ([255a33d](https://github.com/tux86/awssesh/commit/255a33d29af5e2948adb6092e00a26a2cb7af531))
* **cli:** add fire-gradient ASCII wordmark header ([c0d4b0b](https://github.com/tux86/awssesh/commit/c0d4b0b8e1b7743c370fed06b008be464a1dfc02))
* **cli:** add list-first dashboard component ([5575ff6](https://github.com/tux86/awssesh/commit/5575ff627879e824f7f50b69eb5a4ad0ccbcc2a8))
* **cli:** add status, export, refresh, and daemon subcommands ([fd1d262](https://github.com/tux86/awssesh/commit/fd1d26213fa83d3887ca97d9f110f57d379dc593))
* **cli:** add unix-socket daemon server with subscribe/snapshot/refresh ([641d33d](https://github.com/tux86/awssesh/commit/641d33d59a62b2ed961b2baf74658b04656154a0))
* **cli:** add useDaemon hook for live socket state ([9547310](https://github.com/tux86/awssesh/commit/9547310da881fb97bb2b765f26af1bac0ade24fb))
* **cli:** redesign dashboard — highlight cursor, auto-refresh (a/⟳), headers ([7304490](https://github.com/tux86/awssesh/commit/73044908889cb70fc12b5229b2e4bb2a7f65e25a))
* **cli:** redesign TUI — list-first dashboard + in-process auto-refresh ([cc0179c](https://github.com/tux86/awssesh/commit/cc0179c7fa62f776fef8666448b80ad700f05a4b))
* **cli:** replace menu UI with list-first dashboard, details, and settings ([afc4a77](https://github.com/tux86/awssesh/commit/afc4a7768ff65eeca18614878590090ab513ac53))
* **cli:** route argv to subcommands, daemon, or TUI ([6f94800](https://github.com/tux86/awssesh/commit/6f948006486b47869618038fb2ca587523e5b9d3))


### Bug Fixes

* **cli:** close daemon log fd, guard cred expiry fallback, reset notify on manual refresh ([6b864c6](https://github.com/tux86/awssesh/commit/6b864c6b79bbb8eaaf42e82b1257524e0a6081b2))
* **cli:** destroy all daemon connections on stop and surface handler errors ([b8a23f8](https://github.com/tux86/awssesh/commit/b8a23f858a628a5c350343bf5b8cd6019b78a6f9))
* **cli:** harmonize shortcut footers across screens and make q quit on login/settings/details ([bcb9106](https://github.com/tux86/awssesh/commit/bcb910691220c59c5a8c2099f01f6b7f2909ee01))
* **cli:** harmonize shortcut footers; Esc=back on sub-screens, q quits at home only ([62748e0](https://github.com/tux86/awssesh/commit/62748e0f25550575e6044be6dbfe158b0ba21170))
* **cli:** make daemon refresh expiry-aware via role-credential expiry ([a105d8e](https://github.com/tux86/awssesh/commit/a105d8e2711f6ed2d31efa3a1f8bc20243b23724))
* **cli:** make dashboard footer keys stand out and tie a to the auto-refresh marker ([648ef6e](https://github.com/tux86/awssesh/commit/648ef6ece058d4ee8b18d6f7f132130250d3fcd1))
* **cli:** reply to refresh/setFavorite requests, harden socket, prompt stop ([5962e77](https://github.com/tux86/awssesh/commit/5962e778c2985a879d261936dc11d0032fefd14a))
* **cli:** stop global q-quit from firing during filter typing; surface device-auth init failure ([dbda704](https://github.com/tux86/awssesh/commit/dbda7045ac30b71a7b3b0055c80b32bd5965158a))

## [1.3.1](https://github.com/tux86/awssesh/compare/v1.3.0...v1.3.1) (2026-06-11)


### Bug Fixes

* **cli:** restore action bar top margin when no status items ([7189bba](https://github.com/tux86/awssesh/commit/7189bbaa66b2372437f77c2391ab23a239616f7e))
* **cli:** restore action bar top margin when no status items ([8808ced](https://github.com/tux86/awssesh/commit/8808ced9af9b144158f3e09828d5b8fe78bd5486))

## [1.2.3](https://github.com/tux86/awssesh/compare/v1.2.2...v1.2.3) (2026-03-26)

### Bug Fixes

* **ci:** checkout release tag for builds, use npx semantic-release like presto ([076e21c](https://github.com/tux86/awssesh/commit/076e21c6291533c226cc03d0044729cf9e34f65b))

## [1.2.2](https://github.com/tux86/awssesh/compare/v1.2.1...v1.2.2) (2026-03-26)

### Bug Fixes

* **ci:** build binaries after version bump so version matches release ([1f15fd3](https://github.com/tux86/awssesh/commit/1f15fd35d25091f351193bdd61727299949a7d0b))

## [1.2.1](https://github.com/tux86/awssesh/compare/v1.2.0...v1.2.1) (2026-03-26)

### Bug Fixes

* **cli:** separate status bar and action bar with individual dividers ([ddc19ae](https://github.com/tux86/awssesh/commit/ddc19ae9efe20ed279b7c4a359a6241ef066541f))

## [1.2.0](https://github.com/tux86/awssesh/compare/v1.1.1...v1.2.0) (2026-03-26)

### Features

* embed web assets in binary, add --version flag, fix dev workflow ([92b9a83](https://github.com/tux86/awssesh/commit/92b9a83e33e1e913ac4ed9e2ea6a43437c19ac57))
* show version and update notification in CLI and web UI ([264b16d](https://github.com/tux86/awssesh/commit/264b16d621d74290f61a09d64fb32f7677b6d2fa))

### Bug Fixes

* **ci:** remove redundant syntax check step ([ba0300c](https://github.com/tux86/awssesh/commit/ba0300c1e2c69d091937a968f45a32fb2c7345c5))

## [1.1.1](https://github.com/tux86/awssesh/compare/v1.1.0...v1.1.1) (2026-03-26)

### Bug Fixes

* handle port-in-use gracefully instead of crashing ([237aacd](https://github.com/tux86/awssesh/commit/237aacd1b4ab314dfb8d5b7533efeecf16fdd214))

## [1.1.0](https://github.com/tux86/awssesh/compare/v1.0.1...v1.1.0) (2026-03-26)

### Features

* add Homebrew tap with auto-update on release ([8e9adfe](https://github.com/tux86/awssesh/commit/8e9adfe822a2742901e80fbdb0d91831ccaac098))

## [1.0.1](https://github.com/tux86/awssesh/compare/v1.0.0...v1.0.1) (2026-03-26)

### Bug Fixes

* **cli:** replace any with unknown in list component interfaces ([372fafa](https://github.com/tux86/awssesh/commit/372fafa0955435d4e4dd084393992f28e5ec9714))

## 1.0.0 (2026-03-26)

### Features

* initial release — AWS SSO credential manager with CLI and web UI ([315be57](https://github.com/tux86/awssesh/commit/315be570f7f60de7318b0b2d1b2caac2ac5ff453))
