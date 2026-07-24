import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'

// ESLint方針（2026-07-24たきと指示「まずESLintだけ入れる」）：
// 目的は「buildは通るが実行時に落ちる」事故の機械検出。本命2ルールをエラーで守る：
//   ① no-undef        … 未定義変数の参照（例：確認ページ質問タブの me 未定義→画面真っ白）
//   ② rules-of-hooks  … フック順序違反（React error #310→画面真っ黒。day4の教訓）
// このコードベースの意図的な書き方はノイズにしない（催促で本命が埋もれるのを防ぐ）：
//   ・catch {} で握りつぶす既存イディオム → allowEmptyCatch
//   ・{false && (...)} の一時非表示UI → no-constant-binary-expression off
//   ・残置変数（farmerExp等・CLAUDE.md方針で意図的に残す）→ no-unused-vars off
//   ・日本語UIの全角スペース（JSXテキスト・文字列・コメント内）→ skipで許可。コード位置の全角のみ検出
// react-hooks v7の新ルール群（purity等）は将来の宿題としてwarn/offに降格（本命の信号を優先）。
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-undef': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipJSXText: true, skipComments: true }],
      'no-constant-binary-expression': 'off',
      'no-unused-vars': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/static-components': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
  {
    // ルート直下の設定ファイル（vite.config.js等）とVercelサーバレス関数（api/）はNode環境＝processなどのグローバルを許可
    files: ['*.js', 'api/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
])
