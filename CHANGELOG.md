## [1.3.0](https://github.com/tux86/ssomatic/compare/v1.2.3...v1.3.0) (2026-06-11)

### ⚠ BREAKING CHANGES

* the web UI is removed and Homebrew/binary distribution is
replaced by npm (npx ssomatic / npm i -g ssomatic).

### Features

* distribute as a CLI-only npm package ([5307746](https://github.com/tux86/ssomatic/commit/5307746d89817027319176b4da3fd7a60f6599c7))

### Refactoring

* **aws:** replace Bun APIs with node:fs/promises and node:child_process ([ffcc9c0](https://github.com/tux86/ssomatic/commit/ffcc9c03f57059a9f146f3d0e999dde64e2c6fdf))
* **cli:** remove web UI layer and toolchain ([d6f3f53](https://github.com/tux86/ssomatic/commit/d6f3f53eb374f656bf2e3d8b11b55117eaa86bdb))
* drop dead web eslint block, fix CONTRIBUTING, harden ~/.aws writes ([b15cb3c](https://github.com/tux86/ssomatic/commit/b15cb3c01dc8de09f6dc9ae591d465af0101dcdf))

## [1.2.3](https://github.com/tux86/ssomatic/compare/v1.2.2...v1.2.3) (2026-03-26)

### Bug Fixes

* **ci:** checkout release tag for builds, use npx semantic-release like presto ([076e21c](https://github.com/tux86/ssomatic/commit/076e21c6291533c226cc03d0044729cf9e34f65b))

## [1.2.2](https://github.com/tux86/ssomatic/compare/v1.2.1...v1.2.2) (2026-03-26)

### Bug Fixes

* **ci:** build binaries after version bump so version matches release ([1f15fd3](https://github.com/tux86/ssomatic/commit/1f15fd35d25091f351193bdd61727299949a7d0b))

## [1.2.1](https://github.com/tux86/ssomatic/compare/v1.2.0...v1.2.1) (2026-03-26)

### Bug Fixes

* **cli:** separate status bar and action bar with individual dividers ([ddc19ae](https://github.com/tux86/ssomatic/commit/ddc19ae9efe20ed279b7c4a359a6241ef066541f))

## [1.2.0](https://github.com/tux86/ssomatic/compare/v1.1.1...v1.2.0) (2026-03-26)

### Features

* embed web assets in binary, add --version flag, fix dev workflow ([92b9a83](https://github.com/tux86/ssomatic/commit/92b9a83e33e1e913ac4ed9e2ea6a43437c19ac57))
* show version and update notification in CLI and web UI ([264b16d](https://github.com/tux86/ssomatic/commit/264b16d621d74290f61a09d64fb32f7677b6d2fa))

### Bug Fixes

* **ci:** remove redundant syntax check step ([ba0300c](https://github.com/tux86/ssomatic/commit/ba0300c1e2c69d091937a968f45a32fb2c7345c5))

## [1.1.1](https://github.com/tux86/ssomatic/compare/v1.1.0...v1.1.1) (2026-03-26)

### Bug Fixes

* handle port-in-use gracefully instead of crashing ([237aacd](https://github.com/tux86/ssomatic/commit/237aacd1b4ab314dfb8d5b7533efeecf16fdd214))

## [1.1.0](https://github.com/tux86/ssomatic/compare/v1.0.1...v1.1.0) (2026-03-26)

### Features

* add Homebrew tap with auto-update on release ([8e9adfe](https://github.com/tux86/ssomatic/commit/8e9adfe822a2742901e80fbdb0d91831ccaac098))

## [1.0.1](https://github.com/tux86/ssomatic/compare/v1.0.0...v1.0.1) (2026-03-26)

### Bug Fixes

* **cli:** replace any with unknown in list component interfaces ([372fafa](https://github.com/tux86/ssomatic/commit/372fafa0955435d4e4dd084393992f28e5ec9714))

## 1.0.0 (2026-03-26)

### Features

* initial release — AWS SSO credential manager with CLI and web UI ([315be57](https://github.com/tux86/ssomatic/commit/315be570f7f60de7318b0b2d1b2caac2ac5ff453))
