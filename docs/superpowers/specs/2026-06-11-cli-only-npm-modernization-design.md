# SSOmatic v2 — CLI pure, npm, KISS — Design

**Date:** 2026-06-11
**Status:** Approved (design phase)

## Objectif

Simplifier SSOmatic (KISS) pour en faire un projet GitHub public professionnel :
**CLI interactive uniquement** (suppression de la couche web), distribuée via **npm**
(`npx ssomatic`), code **runtime-agnostique** (Node + Bun), avec des **tests unitaires**
sur la logique AWS/SSO.

Aucune fonctionnalité utilisateur n'est retirée : status, refresh/login, daemon
(auto-refresh), favoris et notifications sont conservés. Le travail porte sur le retrait
du web, la plomberie runtime, l'emballage et la modernisation.

## Décisions de cadrage

| Question | Décision |
|----------|----------|
| Forme de la CLI | TUI interactif uniquement (comme aujourd'hui) |
| Fonctionnalités | Toutes conservées (status, refresh/login, daemon, favoris+notifications) |
| Distribution | npm — `npx ssomatic` / `bunx ssomatic` / `npm i -g ssomatic` |
| Runtime | Node ≥ 18 **et** Bun (code agnostique) |
| Tests | Tests unitaires sur la logique AWS/SSO (`bun test`), pas de tests TUI |

---

## 1. Suppression du web → nouvelle structure

### Fichiers/dossiers supprimés
- `src/web/` en entier (server.ts, client React, `assets.generated.ts`, `index.css`, components, hooks, lib)
- `scripts/embed-assets.ts`
- `vite.config.ts`
- `tailwind.config.js`
- `postcss.config.js`
- `tsconfig.web.json`

### Dépendances retirées
`vite`, `@vitejs/plugin-react`, `tailwindcss`, `autoprefixer`, `postcss`,
`react-dom`, `@types/react-dom` (Ink utilise son propre renderer, pas react-dom).

`react` est conservé (requis par Ink).

### Structure finale
```
src/
├── aws/        # sso.ts, aws.ts, utils.ts  (logique, runtime-agnostique)
├── cli/        # index.tsx, components/, hooks/
└── version.ts
```

### Nettoyage associé
- Retrait de `webServer` et `webPort` de `AppSettings` et `DEFAULT_SETTINGS` (`sso.ts`)
- Retrait de la vue `settings-webport` et de l'état de vue correspondant dans `cli/index.tsx`
- Retrait du toggle `w` (web server) dans l'ActionBar / Header / `useInput`
- Retrait de l'import et des appels `startServer`/`stopServer`/`isServerRunning` dans `cli/index.tsx`

---

## 2. Code runtime-agnostique (Node + Bun)

Les ~9 appels Bun-spécifiques de `src/aws/sso.ts` sont remplacés par les API Node standard
afin que `npx ssomatic` (qui s'exécute sous Node) fonctionne :

| Bun (actuel) | Remplacement Node |
|--------------|-------------------|
| `Bun.file(p).text()` | `await readFile(p, "utf8")` (`node:fs/promises`) |
| `Bun.file(p).json()` | `JSON.parse(await readFile(p, "utf8"))` |
| `Bun.write(p, data)` | `await writeFile(p, data)` (`node:fs/promises`) |
| `Bun.spawn([cmd, ...])` | `spawn(cmd, [...])` (`node:child_process`) |

Localisations connues dans `sso.ts` : lignes ~108, 124, 129, 137, 156, 293
(fichiers credentials / settings / cache token) et ~375, 422, 428
(`openBrowser`, `notify-send`/notifications).

Le résultat tourne sous **Node ≥ 18 et Bun**. `src/aws/utils.ts` utilise déjà
`node:child_process` (clipboard). Aucune dépendance ajoutée.

---

## 3. Distribution npm

### `package.json`
- `"private": true` → **retiré**
- Ajout :
  - `"bin": { "ssomatic": "dist/cli.js" }`
  - `"files": ["dist"]`
  - `"engines": { "node": ">=18" }`
- Sortie de build avec shebang `#!/usr/bin/env node`

### Build
Remplacement de l'ancien pipeline (`vite build && embed-assets && bun build --compile`) par :
```
bun build src/cli/index.tsx --target node --outfile dist/cli.js
```
- Dépendances runtime **externes** (non bundlées) et déclarées dans `dependencies` →
  npm/bun les installe chez l'utilisateur.
- Plus de compilation en binaire autonome, plus de Vite, plus d'embedding d'assets.
- Le shebang `#!/usr/bin/env node` doit être présent en tête de `dist/cli.js`
  (préservé depuis la source ou ajouté par une étape post-build minimale).

### Scripts `package.json` (cibles)
```jsonc
{
  "start": "bun run src/cli/index.tsx",
  "dev":   "bun run --watch src/cli/index.tsx",
  "build": "bun build src/cli/index.tsx --target node --outfile dist/cli.js",
  "lint":  "eslint src",
  "test":  "bun test",
  "prepare": "husky"
}
```
(`prestart` supprimé — il ne servait qu'à générer `assets.generated.ts`.)

### Release (semantic-release)
- Configuration conservée.
- **Activation de `@semantic-release/npm`** (déjà présent en devDependencies) pour publier
  sur npm automatiquement à chaque release.
- Retrait de l'attachement de binaires aux releases GitHub (plus de binaires produits).
- Prérequis : secret `NPM_TOKEN` dans les settings du repo GitHub (en plus du `RELEASE_TOKEN`
  existant pour GitHub Releases).

### Usage final
```bash
npx ssomatic          # zéro install
bunx ssomatic
npm i -g ssomatic     # install globale
```

---

## 4. Tests (`bun test`)

Tests unitaires ciblés sur la logique pure, sans TUI :

- **`sso.ts`**
  - Parsing du fichier de config AWS (ini) → `discoverProfiles`
  - Lecture/écriture du cache token (round-trip via fichier temp)
  - Calcul de statut `valid` / `expired` selon la date d'expiration
  - Tri par favoris (`sortByFavorites`)
  - `formatExpiry`
- **`utils.ts`**
  - `formatJson` (JSON valide / invalide)

Modalités :
- Fixtures fichiers via `os.tmpdir()` pour isoler le filesystem.
- Lancé par `bun test`, branché dans la CI.
- Optionnel : badge coverage.

---

## 5. Modernisation / polish « repo public pro »

- **README** : suppression de la section Web UI et du GIF web, recentrage CLI,
  install via `npx` mise en avant, badges `npm version` + `npm downloads`.
- **CI** (`.github/workflows/ci.yml`) : simplifiée → `lint` + `test` + `build`
  (plus de build web).
- **`package.json`** : `description` et `keywords` recentrés CLI/AWS SSO.
- **`CLAUDE.md`** : mise à jour de la structure et des commandes pour refléter
  la nouvelle architecture (plus de section web, plus de scope `web`).

---

## Hors périmètre (YAGNI)

- Mode commandes directes / sous-commandes scriptables (rejeté : TUI uniquement).
- Binaires GitHub autonomes (remplacés par npm).
- Tests du TUI Ink (fragiles).
- Toute refonte de l'architecture `aws/` ↔ `cli/` (déjà propre).

## Risques / points d'attention

- **Shebang Node** : vérifier que `dist/cli.js` démarre bien sous Node pur
  (pas seulement Bun) après le refactor runtime — c'est le critère de succès principal.
- **`NPM_TOKEN`** : doit être configuré avant la première release npm.
- **`scope` commitlint** : le scope `web` devient inutile ; à retirer de la config
  des scopes autorisés dans un commit `chore`.
