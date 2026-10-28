# chitose-bank

## 構成と入口

- [管理の8原則](docs/repository-management.md)：配置・公開範囲・検証・完了報告の共通ルール（正本）。
- [AGENTS.md](AGENTS.md)：このリポジトリで作業する際の安全・作業指示。
- `src/App.jsx` / `src/components/`：アプリの組み立て・既存画面・共用UI。既存画面は一括移動しない。
- `src/features/`：機能ごとの実装。求人は `jobs/` 配下（`create/`、[search/](src/features/jobs/search/)（一覧取得・並び・先読み）、[favorites/](src/features/jobs/favorites/)）。
- `src/lib/`：複数機能で使う基盤・共用処理。機能専用の処理は所有する feature に置く。
- `api/` / `supabase/migrations/`：サーバー境界とDB変更履歴。適用済み migration は書き換えない。
- `scripts/` / `docs/`：合成データの検証と設計・運用文書。[PR確認項目](.github/pull_request_template.md)も参照。

検証は `npm ci` → `npm run build`（critical tests・lint・production bundle）。
検索の取得・先読み回帰は `node --test scripts/search-jobs.test.mjs`。
検索・いいねの実ブラウザ検証は `node scripts/saved-job-browser.mjs`（隔離fixture、Chromiumが必要）。

## 開発環境メモ

### React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

### React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

### Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
