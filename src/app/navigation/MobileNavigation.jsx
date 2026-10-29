import { Avatar } from "../../components/ui";
import { NavIcon } from "../../components/NavIcons";
import { ROLE_GREEN, ROLE_ORANGE } from "../../lib/utils";
import { readScheduleRoute } from "../../features/today/schedule";

// モバイル下部ナビの表示と選択操作を所有する。認証・取得・URL同期のstateはAppに残す。
// 掲載/チャット中の再読込保護やプロフィール項目からの帰路は、抽出前の優先順を維持する。
export function MobileNavigation({
  me, hasEmp, empCtx, curHash, safeTab, navFlip, navBadges, meAvatar,
  showJobPost, chatAppId, tabUrlKeys, setTab, setMobileMenuOpen,
}) {
  // 下部ナビ（2026-08-22たきと指示「農家と働き手の切り替えはマイページだけに限定」）：
  // ★モード（empCtx）でナビを変えない＝切り替えても行き先が動かない。
  //   カレンダーの行き先だけは【雇い手の面を持っているか（hasEmp）】で決める＝capabilityの話so
  //   モードを切り替えても同じページに着く（働き手モードで開くと自分の求人カードが消える件の根治）。
  //   雇い手の面がある人＝#/profile/employer/calendar（カレンダー＋自分の求人＋日タップで応募者＋
  //   働き手としての予定も埋め込み表示）／持たない人＝#/saved（働き手のカレンダー）。
  // 4タブ＝さがす・カレンダー・チャット・マイページ（2026-08-23統一・「今日」は2026-08-22に削除）
  // 訪問者版3タブ（未ログイン・2026-07-24）：さがす／入れ方／登録・ログイン
  // アイコンは全ナビ共通のアウトラインSVG（NavIcon・2026-08-22）＝下部ナビの絵文字は全廃
  const visitorNav = [
    { k:"search",  icon:<NavIcon name="search" />,  label:"さがす" },
    { k:"install", icon:<NavIcon name="install" />, label:"入れ方", hash:"/install" },
    { k:"login",   icon:<NavIcon name="login" />,   label:"登録・ログイン", hash:"/login" },
  ];
  // カレンダーのタブ（行き先だけ capability で出し分け・ラベルとアイコンは共通）。
  // matchは「そのタブの領域に居るか」を明示する（2026-07-27）＝hashのstartsWithだけだと
  // 雇い手プロフィール等で どのタブも点かない穴があった
  const calendarTab = hasEmp
    ? { k:"emp-calendar", icon:<NavIcon name="calendar" />, label:"カレンダー", hash:"/profile/employer/calendar",
        match: h => h.startsWith("profile/employer/calendar") }
    : { k:"saved", icon:<NavIcon name="calendar" />, label:"カレンダー" };
  // 「掲載」は下書き・公開中の求人を管理する入口。新規作成と保存した求人の再開をここに集約する。
  // 農家モードのときだけ表示し、掲載フロー中も同じタブを選択状態にする。
  const postTab = { k:"post", icon:<NavIcon name="postJob" />, label:"掲載", hash:"/profile/employer/drafts",
    match: h => /^profile\/employer\/(drafts|active|expired)$/.test(h) || h === "work/new" || h.startsWith("work/new/") || h.startsWith("work/edit/") };
  const navTabs = !me
    ? visitorNav
    : [
        { k:"search",  icon:<NavIcon name="search" />,  label:"さがす" },
        calendarTab,
        { k:"chats",   icon:<NavIcon name="chats" />,   label:"チャット" },
        ...(empCtx ? [postTab] : []),
        { k:"profile", icon:<NavIcon name="profile" />, label:"マイページ",
          match: h => !!readScheduleRoute(h) || h === "profile" || h === "profile/employer" || h.startsWith("profile/employer/profile") || h.startsWith("profile/worker") },
      ];

  return (
    <header className="app-header app-header-mobile">
      <div className={"app-header-mobile-tabs" + (navFlip ? " " + navFlip : "")}>
        {navTabs.map(t => {
          const cur = curHash; // ★描画中にwindow.location.hashを読まない（同一タブ内の移動で点灯が固まる・2026-07-27）
          const isActive = t.match
            ? t.match(cur)
            : t.hash
            ? cur.startsWith(t.hash.replace(/^\//, ""))
            : safeTab === t.k;
          // 宿題バッジ（第12弾）：数字＝待たせている/自分の宿題の件数。求人(農家)の差し戻しのみ⚠フラグ
          // ★「今日」タブの赤バッジ（navBadges.todo）は削除（2026-08-21たきと指示「タブの赤バッジも必要ない」・
          //   今日ページ内の丸数字バッジ全廃と対）。my_nav_badges の todo は取得だけ続く（DB不変・読み手なし）
          const badge = t.k === "chats" ? (navBadges.chat_threads || 0)
            : t.k === "profile" ? (navBadges.review_due || 0)
            : (t.badge || 0);
          // ⚠（job_revision＝修正のお願い）の表示は「求人」タブごと消えた（2026-08-21・さがすに差し替え）。
          // 修正のお願いの気づきは今日ページの「📝求人の修正」箱とお知らせ・メールが引き続き担う
          return (
          <button key={t.k} data-prefetch-route={"/" + t.k}
            onClick={() => {
              setMobileMenuOpen(false);
              // 項目ページ（#/profile/{worker|employer}/profile/{項目}）を開いている時の「マイページ」＝
              // 編集ページ（項目の一覧）へ戻る（2026-08-25たきと指示）。
              // ★下の「同じタブをもう一度タップ＝読み直し」より先に見る＝読み直すと書きかけが飛ぶため
              if (t.k === "profile") {
                const _h = window.location.hash.replace(/^#\/?/, "");
                const schedule = readScheduleRoute(_h);
                if (schedule) { window.location.hash = schedule.role === "farmer" ? "/profile/employer" : "/profile/worker"; return; }
                const _m = _h.match(/^(profile\/(?:worker|employer)\/profile)\/.+/);
                if (_m) { window.location.hash = "/" + _m[1]; return; }
              }
              // いま見ているタブをもう一度タップ＝読み直してページの先頭へ（2026-08-23たきと指示
              // 「下部ヘッダーと同じページの場合、リロード後トップへ遷移」）。
              // ★入力を抱えている2つは除く＝求人フロー（showJobPost）とチャット（chatAppId）。
              //   リロードすると書きかけthat飛ぶため（day4の教訓「reloadでstateは全消去される」）。
              // ★先頭へ戻す仕掛けは2段：ここで先に0まで戻して【その位置thatブラウザに保存される】ようにし、
              //   起動側でも合図を見て0にする（iOSはリロード後に独自の復元thatが走ることthatあるため）
              if (isActive && !showJobPost && !chatAppId) {
                try { sessionStorage.setItem("cb_topAfterReload", "1"); } catch {}
                window.scrollTo(0, 0);
                window.location.reload();
                return;
              }
              // プロフィールタップ＝現在モードのトップへ（農家モード→農家プロ入口／それ以外→働き手入口）
              if (t.k === "profile") {
                if (empCtx) {
                  window.location.hash = "/profile/employer";
                  window.dispatchEvent(new Event("cb:employerHome"));
                } else {
                  setTab("profile");
                  window.location.hash = "/profile/worker";
                  window.dispatchEvent(new Event("cb:workerHome"));
                }
                return;
              }
              // hash指定のタブは、hashの先頭区画から行き先タブを決める（2026-07-27修正）。
              // 以前は一律 setTab("profile") だったため、tab→URL同期useEffectが直後に
              // #/install・#/login を #/profile へ巻き戻し、訪問者の「入れ方」「登録・ログイン」が
              // プロフィールに飛んでいた（農家ナビの行き先は /profile/… なので偶然動いていた）
              if (t.hash) {
                const seg = t.hash.replace(/^\//, "").split("/")[0];
                setTab(tabUrlKeys.includes(seg) ? seg : "profile");
                window.location.hash = t.hash;
                return;
              }
              setTab(t.k); window.location.hash = "/" + t.k;
            }}
            className={"app-header-mobile-tab" + (isActive ? " active" : "")}>
            <span className={"icon" + (t.k === "chats" && (navBadges.chat_threads || 0) > 0 ? " cb-jump" : "")} style={{ position:"relative" }}>
              {t.k === "profile" && me ? <Avatar url={empCtx ? meAvatar.empUrl : meAvatar.url} name={(empCtx ? meAvatar.empName : meAvatar.name) || me?.name} size={26} bg={empCtx ? ROLE_GREEN : ROLE_ORANGE} /> : t.icon}
              {badge > 0 && (
                <span style={{ position:"absolute", top:-4, right:-10, minWidth:16, height:16, borderRadius:8, background:"#E24B4A", color:"#fff", fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 4px", pointerEvents:"none" }}>{badge > 99 ? "99+" : badge}</span>
              )}
            </span>
            <span className="label">{t.label}</span>
          </button>
          );
        })}
      </div>
    </header>
  );
}
