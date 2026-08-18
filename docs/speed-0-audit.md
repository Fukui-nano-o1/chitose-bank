# Speed-0：更新速度の現状監査（基準点 6003ca9・2026-08-18）

実装変更なし（src/ は1行も触っていない）。数字は本番の実測ログのみ。取れなかったものは「未計測」と書く。

## 計測方法と限界
- 使ったもの：Supabase の edge_logs / postgres_logs / postgrest_logs / realtime_logs（直近24時間）、
  pg_stat_statements（2026-04-08以降・132日分）、pg_publication、`npm run build` 後の実 dist、既存コードの読み取り。
- 使えなかったもの：ブラウザ実機（検証の分担規則・環境ともに不可）。DevTools の各時刻
  （fetch開始／React反映）は取得できない。chitose-bank.com は本セッションの egress で遮断されており
  本番配信中の /sw.js を直接読めない（dist が同一 config の生成物なので dist を正とした）。
  Vercel API はこのアカウントから 403（プロジェクトが見えない）＝デプロイ時間は未計測。
- したがって「操作発生→DB確定」「fetch開始→完了」は **サーバー側の origin_time** で代表させた。
  端末〜エッジ間のRTTは含まれていない（実際の体感はこれより遅い）。

## 1. 実測：起動時に何が起きているか（2026-08-18 03:19 JST・iPhone Safari の実セッション）

| 時刻 | 内容 | origin_time |
|---|---|---|
| 03:19:16–18 | auth/token, realtime websocket ×2 | 245–380 ms |
| 03:19:19 | REST **21本を同時発射** | 12,229–14,453 ms |
| 03:19:23–24 | REST **17本を追加発射** | 11,861–14,947 ms |
| 03:19:26 | REST 3本 | 9,707–10,038 ms |
| 03:19:23–31 | Realtime テナントの**コールドブート**（パーティション作成→レプリケーションスロット作成→logical decoding 開始） | 約7秒 |
| 03:19:26–47 | PostgREST が再接続、スキーマキャッシュ再読込 ×2 | 3,297 ms / 1,643 ms |
| 03:19:38 | 嵐のあとの**単発**リクエスト（worker_cards_for_farmer） | **378 ms** |

同じ1回のアプリ起動で **REST 41本**。うち重複＝applications×3・worker_profiles×3・employer_profiles×3・
page_events×3・my_nav_badges×2・jobs(GET+HEAD)・jobs_public(GET+HEAD)・emergency_contacts×2。

### 温まっている時は速い（同じ本番・同じ端末）
| 時間帯 | REST件数 | p50 | p95 | 3秒超 |
|---|---|---|---|---|
| 08-18 00時台 | 223 | **20 ms** | 2,587 ms | 5 |
| 08-17 05時台 | 230 | 207 ms | 8,298 ms | 20 |
| 08-17 10時台 | 439 | 351 ms | 12,928 ms | 110 |
| 08-18 03時台 | 39 | **13,402 ms** | 14,402 ms | 35 |

秒あたり30本の同時発射でも p50 13–47ms で返る回がある一方、21本で p50 13.4秒の回がある＝
**同時本数そのものより「冷えた回に当たるか」で二極化している**。冷えた回の内訳は上表のとおり
（Realtimeテナント起動 + PostgREST再接続 + スキーマキャッシュ再読込が起動バーストと重なる）。
クライアントの fetch タイムアウトは 15,000ms（lib/supabase.js）＝**実測の最大 14,947ms は失敗の一歩手前**。

### DB自体は暇（＝クエリの重さが原因ではない）
- DBサイズ 25MB、max_connections 60、計測時の active 接続 2。
- 03:20 の cron 2本は 183ms / 219ms で完走（Postgres は同時刻に健全）。
- 主要RPCのDB内実行時間（pg_stat_statements・132日平均）：
  my_farm_applicants 488ms / **my_nav_badges 325ms（6,017回・最多呼び出し）** / get_my_calendar_jobs 103–230ms /
  my_todo_items 185ms / my_farm_jobs 163ms / my_unread_message_counts 99ms / is_account_moderated 36ms。
  → 12〜15秒のうち DB 実行は数百ms。残りは **待ち行列**。

## 2. Realtime の使用状況（実測）

publication `supabase_realtime` に入っているテーブル：
**applications / messages / admin_messages / notifications / worker_profile_view_counts**（jobs は入っていない）

| 購読箇所 | テーブル | 受信時にすること |
|---|---|---|
| App.jsx `unread-badge` | messages, admin_messages (INSERT) | 未読バッジ＋トースト |
| App.jsx `hired-watch` | applications (UPDATE, worker_id) | 採用おめでとうボックス |
| App.jsx `stage-watch` | applications (*, worker_id/farmer_id) | 段階お祝いボックス |
| App.jsx `cb-profile-approved` | notifications (INSERT) | 承認ボックス |
| ChatList `chatlist-live` | messages(INSERT), applications(UPDATE) | 一覧の未読・並べ替え |
| ChatView `chat-{id}` | messages (INSERT, application_id) | 本文の再読込 |
| AdminChatFab | admin_messages (INSERT) | 運営DM |
| WorkerWorkRecord | worker_profile_view_counts (*) | 閲覧数 |

**未使用（＝DBが変わってもUIが変わらない）**
- 求人（jobs）… publication に無い。求人の status 変更を知る経路がゼロ。
- さがす一覧 / 農家お仕事タブ（求人面・応募者面）/ 今日ページ / 応募状況 …
  applications は publication に有るのに、購読しているのは「バッジとお祝いボックス」だけで、
  一覧・今日ページを**再取得する購読も、再取得を促すイベントも無い**（アプリ内イベントは
  `cb:unreadRefresh` 等のバッジ系のみで、データ再取得のバスは存在しない）。
- 復帰時の再取得（visibilitychange / focus）を持つのは **ChatView / ChatList / AdminChatFab の3つだけ**。
  TodayPage の読み込みは `useEffect(..., [])`＝マウント1回きり。

## 3. Service Worker（`npm run build` 後の実 dist を読んだ結果）

- **最終 dist/sw.js の正体＝vite-plugin-pwa（generateSW）+ Workbox の生成物**（3,532バイト・precache 40件 1,879KiB）。
  `public/sw.js`（自作・push担当）は同じ `/sw.js` に**上書きされて消える**（dist/sw.js に
  `addEventListener('push')` / `notificationclick` / `showNotification` / `setAppBadge` は **0件**）。
- **登録経路は二重**：index.html に注入された `/registerSW.js`（`register('/sw.js', {scope:'/'})`）と、
  `src/main.jsx` の `register('/sw.js')`。同じURLなので二重登録の実害は無いが、登録が2系統ある。
- **キャッシュ戦略に死んだルートがある**（登録順の問題・生成コードで確認）：
  ```
  registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")))   ← 先に登録
  registerRoute(req.mode==='navigate', NetworkFirst('pages-cache', 3s))        ← 後に登録＝到達しない
  ```
  Workbox のルータは**先に登録された方が勝つ**。ナビゲーションは常に **precache の index.html**（cache-first）で
  返る。vite.config のコメント「ページ本体は network-first で常に最新を取りに行く」は**実態と違う**。
  pages-cache は誰も書き込まない（main.jsx が起動時に1度 delete するだけ）。
- フォント2ルート（SWR / CacheFirst 1年）は有効。
- **新ビルドの取り込み方**：`skipWaiting + clientsClaim` は入っているが、`registerSW.js` に**定期 update 呼び出しが無い**。
  → 開いたままのタブは、いつまでも新コードを取りに行かない。リロードすると
  ①ナビゲーションは precache の**旧** index.html で起動 → ②裏で新 sw.js を取得・install（1.9MB precache）→ ③activate。
  新コードが画面に出るのは**次のリロード**。これが「2回リロードしないと新しくならない」の構造。
- 古い index.html が返る経路：**残っている**（precache 経由＝上記①）。

## 4. 現状値（Speed-0 の結論）

```
DB→UI（別端末で開いている画面が変わるまで）:
  求人 status      構造上ゼロ経路（realtime対象外・再取得なし）＝次のマウント/リロードまで無限
  応募 status      Realtime は届く（applications購読）が、更新されるのはバッジ／お祝いボックスのみ。
                   応募者一覧・今日ページ・応募状況は無限（次のマウント/リロードまで）
  Today            無限（マウント1回きり・購読なし・復帰再取得なし）
  Chat             Realtime受信で即時。届かない時も保険ポーリングで最大 5,000 ms
                   ※Realtime受信そのものの遅延は 未計測（クライアントを動かせないため）
復帰→最新:
  Chat 系3画面     即時（visibilitychange/focus で再読込）
  それ以外         無限（復帰再取得なし）
Deploy→新コード:
  Vercel push→Ready   未計測（Vercel API 403・ローカル build は eslint込み約13秒/vite単体 495ms）
  端末が新コードを使うまで
    開いたままのタブ   無限（定期 update 無し）
    リロード           1回目は旧コードで起動、2回目のリロードで新コード（コード由来・実測は未計測）
fetch（サーバー側 origin_time・端末〜エッジのRTTは含まない）:
  温まっている時      p50 20–207 ms
  冷えた回            p50 13,402 ms / max 14,947 ms（クライアント timeout 15,000 ms の直前）
  起動1回のREST本数   41本（7秒間に 21+17+3）
  嵐の直後の単発      378 ms
初描画（画面を開く→何かが出るまで）:
  viewCache(localStorage) により 0 ms で前回内容（さがす/お仕事/今日/応募状況/プロフィール入口ほか）
```

## 5. ボトルネック順位

1. **起動時の41本同時発射が、冷えた回に12〜15秒の壁になる。**
   Realtimeテナントのコールドブート（7秒）と PostgREST の再接続＋スキーマキャッシュ再読込（1.6–3.3秒）が
   同じ瞬間に重なり、全リクエストが待ち行列に入る。DB実行は数百msなので、**待ちが本体**。
   重複リクエスト（同じ行を3回取る等）が本数を押し上げている。
2. **DB→UI の伝播経路が chat 以外に存在しない。**
   jobs は realtime 対象外。applications は購読しているのにデータ再取得に繋がっていない。
   復帰時の再取得も chat 系だけ。「秒で反映」以前に「反映しない」が現状。
3. **SW のルート登録順で pages-cache が死んでおり、新コードの反映がリロード2回。**
   加えて push ハンドラが最終成果物から消えている（generateSW が public/sw.js を上書き）。

## 6. Speed-1 で直す対象（最大3件）

1. **起動バーストの削減**（41本 → 重複排除と後回しで削る）。1件あたりの効果が最も大きく、
   冷えた回の12〜15秒と 15秒タイムアウトの両方に効く。
2. **DB→UI の再取得配線を1本通す**：既存の applications 購読と復帰(visibilitychange)に、
   応募者一覧／今日ページ／さがすの再取得を繋ぐ。jobs は publication 未加入なので別途判断。
3. **SW のルート順序の修正と push ハンドラの復活**（NetworkFirst を先に／generateSW と自作SWの統合）。

※ 17個見つかっても直すのは3個。それ以外（my_nav_badges 325ms×6,017回、page_events の起動時3回、
health check の1.35秒など）は本書に記録だけ残し、Speed-1 では触らない。
