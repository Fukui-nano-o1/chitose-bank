// 農家のアクションページ（#/admin/farmer-pages・管理者専用・2026-08-11たきと指示）。
// 農家が最初から最後まで通る画面を、順序どおりに1枚ずつ展開する見本帳。
//
// ★読み取り専用：DBを読まない・書かない・保存も入力もしない（supabaseを一切importしない）。
//   ＝「保存・入力機能の取り扱い」の管理者ゲート論点には非該当。
// ★中身はすべて架空の見本（たきと指示「内容は架空でいい」）。憲法3条「表示にダミー禁止」は
//   利用者に見せる画面の規則で、ここは運営だけが見る見本帳＝AdminBoxRegistryPage の
//   「本番の見た目（サンプル題名）」と同じ扱い。架空であることをページ上でも明記する。
// ★下部バー（.app-header-mobile）と浮遊☰は、この画面だけ「戻る／次へ」に差し替える
//   （appStyles の body:has(.cb-farmer-walk-page) ＋ .cb-walk-bar）。
// ★1画面=STEPSの1要素。画面を足す・消す・並べ替えるのは STEPS だけを直す（他を壊さない）。
import { useState, useEffect } from "react";
import { AdminNav } from "./AdminNav";

const INK = "#222", SUB = "#717171", LINE = "#EBEBEB", SOFT = "#F7F7F7";
const GREEN = "#00A86B", ORANGE = "#F76B1C", BLUE = "#1E88E5", PURPLE = "#8E24AA", RED = "#E24B4A";

/* ── 見本の部品（本番の意匠を写した最小の飾り。状態もイベントも持たない） ───────────── */
function MockBar({ left, title, right }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"12px 14px", borderBottom:`1px solid ${LINE}`, background:"#fff" }}>
      <span style={{ fontSize:15, color:SUB, width:18 }}>{left ?? ""}</span>
      <span className="f-sans" style={{ flex:1, fontSize:14, fontWeight:800, color:INK }}>{title}</span>
      <span className="f-sans" style={{ fontSize:12, fontWeight:700, color:SUB }}>{right ?? ""}</span>
    </div>
  );
}
function MockH({ children, sub }) {
  return (
    <div style={{ marginBottom:14 }}>
      <p className="f-sans" style={{ fontSize:19, fontWeight:800, color:INK, lineHeight:1.45, margin:0 }}>{children}</p>
      {sub && <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.8, margin:"7px 0 0" }}>{sub}</p>}
    </div>
  );
}
function MockCard({ children, style }) {
  return <div style={{ border:`1px solid ${LINE}`, borderRadius:16, padding:14, background:"#fff", ...style }}>{children}</div>;
}
function MockBtn({ children, kind = "primary", full = true }) {
  const s = kind === "primary" ? { background:INK, color:"#fff", border:`1px solid ${INK}` }
    : kind === "green" ? { background:GREEN, color:"#fff", border:`1px solid ${GREEN}` }
    : kind === "danger" ? { background:"#fff", color:RED, border:`1px solid ${RED}` }
    : { background:"#fff", color:"#444", border:`1px solid #DDD` };
  return (
    /* flex:1＝横並びで2つ置いたとき等幅になる（単独で置いたときは無害） */
    <span className="f-sans" style={{ display:full ? "block" : "inline-block", flex:full ? 1 : undefined, textAlign:"center", padding:"12px 16px", borderRadius:14, fontSize:14, fontWeight:800, ...s }}>{children}</span>
  );
}
function MockField({ label, value, ph }) {
  return (
    <div style={{ marginBottom:12 }}>
      <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:INK, margin:"0 0 6px" }}>{label}</p>
      <div className="f-sans" style={{ border:`1px solid ${LINE}`, borderRadius:12, padding:"11px 12px", fontSize:13, color: value ? INK : "#C0C0C0", background:"#fff" }}>{value || ph}</div>
    </div>
  );
}
function MockPills({ items, on }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
      {items.map(t => (
        <span key={t} className="f-sans" style={{ padding:"8px 14px", borderRadius:20, fontSize:13, fontWeight:700,
          border: t === on ? `2px solid ${INK}` : `1px solid ${LINE}`, color: t === on ? INK : SUB, background:"#fff" }}>{t}</span>
      ))}
    </div>
  );
}
function MockChip({ children, bg = SOFT, fg = SUB }) {
  return <span className="f-sans" style={{ display:"inline-block", padding:"3px 10px", borderRadius:9, fontSize:11, fontWeight:700, background:bg, color:fg }}>{children}</span>;
}
function MockPhoto({ h = 120, label = "🌾", radius = 12 }) {
  return <div style={{ height:h, borderRadius:radius, background:"linear-gradient(135deg,#EFEFEF,#E3E3E3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30 }}>{label}</div>;
}
function MockRow({ l, r, edit }) {
  return (
    <div style={{ display:"flex", alignItems:"baseline", gap:10, padding:"9px 0", borderBottom:`1px solid ${SOFT}` }}>
      <span className="f-sans" style={{ fontSize:12, color:SUB, width:78, flexShrink:0 }}>{l}</span>
      <span className="f-sans" style={{ flex:1, fontSize:13, color:INK, fontWeight:600 }}>{r}</span>
      {edit && <span className="f-sans" style={{ fontSize:12, color:GREEN, fontWeight:700 }}>編集</span>}
    </div>
  );
}
function MockAvatar({ label = "は", color = ORANGE, size = 42 }) {
  return <div className="f-sans" style={{ width:size, height:size, borderRadius:"50%", background:color, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.4, fontWeight:800, flexShrink:0 }}>{label}</div>;
}
function MockCards({ items }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
      {items.map(c => (
        <div key={c.l} style={{ position:"relative", border:`1px solid ${LINE}`, borderRadius:16, padding:"16px 6px 12px", textAlign:"center", background:"#fff" }}>
          <div style={{ fontSize:22 }}>{c.e}</div>
          <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:INK, margin:"6px 0 0" }}>{c.l}</p>
          {c.n ? <span className="f-sans" style={{ position:"absolute", top:8, right:8, minWidth:18, padding:"1px 5px", borderRadius:9, background:GREEN, color:"#fff", fontSize:10, fontWeight:800 }}>{c.n}</span> : null}
        </div>
      ))}
    </div>
  );
}
function MockMsg({ me, children, name }) {
  return (
    <div style={{ display:"flex", justifyContent: me ? "flex-end" : "flex-start", marginBottom:8 }}>
      <div style={{ maxWidth:"78%" }}>
        {!me && name && <p className="f-sans" style={{ fontSize:10, color:SUB, margin:"0 0 3px" }}>{name}</p>}
        <div className="f-sans" style={{ padding:"9px 12px", borderRadius:14, fontSize:13, lineHeight:1.7,
          background: me ? GREEN : "#fff", color: me ? "#fff" : INK, border: me ? "none" : `1px solid ${LINE}` }}>{children}</div>
      </div>
    </div>
  );
}

/* ── 農家が通る画面（順序どおり）───────────────────────────────────────────
   ch=章 / name=画面名 / url=本番のURL / act=その画面で農家がする動作 / body=見本の中身 */
const STEPS = [
  /* ═══ 準備（アカウント）═══ */
  { ch:"準備", name:"玄関", url:"#/visit", act:"印刷物のQRを読んで、はじめてサイトに入る。規約とプラポリを読んで同意する。",
    body: () => (
      <div style={{ padding:"34px 18px", textAlign:"center" }}>
        <p className="f-sans" style={{ fontSize:22, fontWeight:800, color:GREEN, margin:0 }}>ちとせ銀行</p>
        <p className="f-sans" style={{ fontSize:13, color:SUB, lineHeight:1.9, margin:"12px 0 22px" }}>吉野川市の農家と、働きたい人をつなぎます。<br />まずは、どんな仕事があるか見てみてください。</p>
        <MockBtn kind="green">同意して見てみる</MockBtn>
        <p className="f-sans" style={{ fontSize:11, color:SUB, marginTop:14 }}>利用規約 ・ プライバシーポリシー</p>
      </div>
    ) },
  { ch:"準備", name:"さがす", url:"#/search", act:"訪問者として求人の相場を見る。この時点では町域・番地・募集主は伏せられている。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockCard style={{ padding:0, overflow:"hidden" }}>
          <MockPhoto h={130} radius={0} />
          <div style={{ padding:12 }}>
            <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:INK, margin:0 }}>ブロッコリー 収穫</p>
            <p className="f-sans" style={{ fontSize:12, color:SUB, margin:"5px 0 8px" }}>徳島県吉野川市 ・ 9月10日〜9月14日</p>
            <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:INK, margin:0 }}>日給 9,000円</p>
          </div>
        </MockCard>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:10, lineHeight:1.8 }}>※ 未ログインの間は、町域・番地・募集主の名前は表示されません（地図もおおまかな位置だけ）。</p>
      </div>
    ) },
  { ch:"準備", name:"ログイン", url:"#/login", act:"メールアドレスを入れて、届いた6桁の番号でログインする。",
    body: () => (
      <div style={{ padding:"26px 18px" }}>
        <MockH sub="番号をメールでお送りします。パスワードは覚えなくて大丈夫です。">ログイン・新規登録</MockH>
        <MockField label="メールアドレス" value="chitose@example.com" />
        <MockBtn kind="green">番号を送る</MockBtn>
        <p className="f-sans" style={{ fontSize:12, color:GREEN, fontWeight:700, textAlign:"center", marginTop:16 }}>はじめての方はこちら</p>
      </div>
    ) },
  { ch:"準備", name:"本人情報の登録", url:"#/account", act:"氏名・生年月日・住所・連絡先を入れて、規約とプラポリに同意する（1回だけ）。",
    body: () => (
      <div style={{ padding:"22px 16px" }}>
        <MockH sub="お仕事のやりとりに使う、いちばん大事な情報です。">本人の情報を教えてください</MockH>
        <MockField label="お名前" value="福井 千歳" />
        <MockField label="生年月日" value="1958年 4月 12日" />
        <MockField label="郵便番号" value="776-0000" />
        <MockField label="住所" value="徳島県吉野川市山川町3-21" />
        <p className="f-sans" style={{ fontSize:12, color:INK, lineHeight:1.9, margin:"4px 0 12px" }}>☑ 利用規約・プライバシーポリシーに同意します</p>
        <MockBtn kind="green">登録する</MockBtn>
      </div>
    ) },
  { ch:"準備", name:"役割をえらぶ", url:"#/role", act:"「農家として始める」を選ぶ。ここで農家の顔ができる（働き手の顔は後からでも作れる）。",
    body: () => (
      <div style={{ padding:"24px 16px" }}>
        <MockH sub="あとから、もう一方の顔を作ることもできます。">どちらで始めますか？</MockH>
        <MockCard style={{ borderColor:GREEN, borderWidth:2, marginBottom:12 }}>
          <p className="f-sans" style={{ fontSize:26, margin:0 }}>🌱</p>
          <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:INK, margin:"6px 0 4px" }}>農家として始める</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.8, margin:0 }}>人手がほしい。求人を出して、働き手を迎える。</p>
        </MockCard>
        <MockCard>
          <p className="f-sans" style={{ fontSize:26, margin:0 }}>🤝</p>
          <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:INK, margin:"6px 0 4px" }}>働き手として始める</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.8, margin:0 }}>農園で働きたい。仕事をさがして応募する。</p>
        </MockCard>
      </div>
    ) },
  { ch:"準備", name:"雇い手プロフィール", url:"#/profile/employer/profile", act:"農園名・写真・待遇・保険・緊急連絡先を埋める。働き手はここを見て応募を決める。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockCard style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12, borderColor:GREEN }}>
          <MockAvatar label="千" color={GREEN} size={52} />
          <div>
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:INK, margin:0 }}>千歳ファーム</p>
            <p className="f-sans" style={{ fontSize:11, color:SUB, margin:"3px 0 0" }}>吉野川市 ・ 就農16年目</p>
          </div>
        </MockCard>
        {[["👤 氏名・農園名","入力済み"],["📍 所在地","入力済み"],["📞 連絡先","入力済み"],["🎁 待遇","あと1つ"],["🛡 保険","入力済み"],["🆘 緊急連絡先","未入力"]].map(([l, r]) => (
          <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 2px", borderBottom:`1px solid ${SOFT}` }}>
            <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:INK }}>{l}</span>
            <MockChip bg={r === "入力済み" ? "#E6F7EF" : "#FFF4E0"} fg={r === "入力済み" ? GREEN : "#C77700"}>{r}</MockChip>
          </div>
        ))}
      </div>
    ) },

  /* ═══ 求人をつくる（#/work/new/{step}）═══ */
  { ch:"求人をつくる", name:"はじめの説明", url:"#/work/new", act:"求人づくりの入口。まず必ず要る「基本情報」から始まると知らせる。",
    body: () => (
      <div style={{ padding:"30px 18px" }}>
        <MockChip bg="#E6F7EF" fg={GREEN}>ステップ 1</MockChip>
        <MockH sub="作物・作業・場所・日程・報酬。ここまでで5分ほどです。あとの項目は、空いた時間に足せます。">まず、基本情報から</MockH>
        <MockPhoto h={130} label="🥦" />
        <div style={{ marginTop:18 }}><MockBtn kind="green">はじめる</MockBtn></div>
      </div>
    ) },
  { ch:"求人をつくる", name:"作物", url:"#/work/new/1", act:"育てている作物を選ぶ（一覧にないものは「その他」で自由入力）。",
    body: () => (
      <div style={{ padding:16 }}>
        <MockH sub="働き手が最初に見る、求人の顔になります。">どの作物の仕事ですか？</MockH>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
          {[["🥦","ブロッコリー",1],["🍅","トマト"],["🍆","なす"],["🥬","レタス"],["🍇","ぶどう"],["✏️","その他"]].map(([e, l, on]) => (
            <div key={l} style={{ border: on ? `2px solid ${INK}` : `1px solid ${LINE}`, borderRadius:16, padding:"16px 4px", textAlign:"center", background:"#fff" }}>
              <div style={{ fontSize:24 }}>{e}</div>
              <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:INK, margin:"6px 0 0" }}>{l}</p>
            </div>
          ))}
        </div>
      </div>
    ) },
  { ch:"求人をつくる", name:"作業", url:"#/work/new/2", act:"やってもらう作業を選ぶ。",
    body: () => (
      <div style={{ padding:16 }}>
        <MockH sub="当日おねがいする作業です。複数あるときは、いちばん多いものを選びます。">どんな作業をおねがいしますか？</MockH>
        <MockPills items={["収穫","定植","選果","袋かけ","草刈り","農薬散布"]} on="収穫" />
      </div>
    ) },
  { ch:"求人をつくる", name:"場所", url:"#/work/new/3", act:"郵便番号から住所を呼び出し、番地まで入れる。最寄り駅からの移動時間も。",
    body: () => (
      <div style={{ padding:16 }}>
        <MockH sub="番地は、承認した働き手にだけ表示されます。">集合する場所を教えてください</MockH>
        <MockField label="郵便番号" value="776-0010" />
        <MockField label="都道府県・市区町村" value="徳島県 吉野川市" />
        <MockField label="町域" value="山川町忌部" />
        <MockField label="番地・建物名" value="字前川 12-3" />
        <MockField label="最寄り駅からの移動時間" value="阿波山川駅 から 10分" />
      </div>
    ) },
  { ch:"求人をつくる", name:"日程と人数", url:"#/work/new/4", act:"カレンダーで作業日を決め、休日を外し、募集人数を入れる。",
    body: () => (
      <div style={{ padding:16 }}>
        <MockH sub="開始日をタップ、終了日をもう一度タップ。休みの日は外せます。">いつ、何人ですか？</MockH>
        <MockField label="募集人数" value="3人" />
        <MockCard style={{ padding:12 }}>
          <p className="f-sans" style={{ fontSize:12, fontWeight:800, color:INK, margin:"0 0 10px" }}>2026年 9月</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
            {["日","月","火","水","木","金","土"].map(d => <div key={d} className="f-sans" style={{ textAlign:"center", fontSize:10, color:SUB }}>{d}</div>)}
            {Array.from({ length:21 }, (_, i) => i + 1).map(d => {
              const sel = d >= 10 && d <= 14, off = d === 13;
              return (
                <div key={d} className="f-sans" style={{ textAlign:"center", padding:"7px 0", borderRadius:8, fontSize:11, fontWeight: sel ? 800 : 500,
                  background: sel && !off ? GREEN : "transparent", color: off ? "#C0C0C0" : sel ? "#fff" : INK, textDecoration: off ? "line-through" : "none" }}>{d}</div>
              );
            })}
          </div>
          <p className="f-sans" style={{ fontSize:11, color:SUB, margin:"10px 0 0" }}>9月10日〜9月14日（13日は休み）</p>
        </MockCard>
      </div>
    ) },
  { ch:"求人をつくる", name:"勤務条件と報酬", url:"#/work/new/5", act:"時間・休憩・時間外の有無・報酬を入れる。最低賃金を下回ると先へ進めない。",
    body: () => (
      <div style={{ padding:16 }}>
        <MockH sub="金額に迷ったら、地域の相場を参考にできます。">働く時間と、お金のこと</MockH>
        <MockField label="勤務時間" value="8:00 〜 16:00（8時間）" />
        <MockField label="休憩時間" value="60分" />
        <MockField label="時間外労働" value="あり（目安 30分ほど）" />
        <MockField label="日給" value="9,000円" />
        <div style={{ background:"#E6F7EF", borderRadius:12, padding:"10px 12px" }}>
          <p className="f-sans" style={{ fontSize:12, color:GREEN, fontWeight:700, margin:0 }}>実働7時間で時給1,285円。徳島県の最低賃金1,046円を上回っています。</p>
        </div>
      </div>
    ) },
  { ch:"求人をつくる", name:"ここからは任意", url:"#/work/new/6", act:"必須はここまで。以降は「選ばれやすくなる情報」で、飛ばしても掲載できる。",
    body: () => (
      <div style={{ padding:"30px 18px" }}>
        <MockChip bg="#E6F7EF" fg={GREEN}>ステップ 2</MockChip>
        <MockH sub="写真や説明があるほど、働き手は安心して応募できます。あとから足すこともできます。">ここからは任意です</MockH>
        <MockPhoto h={130} label="📸" />
        <div style={{ marginTop:18 }}><MockBtn kind="green">つづける</MockBtn></div>
      </div>
    ) },
  { ch:"求人をつくる", name:"写真", url:"#/work/new/7", act:"畑や作業の写真を最大10枚のせる。1枚目が求人の顔（カバー）になる。",
    body: () => (
      <div style={{ padding:16 }}>
        <MockH sub="1枚目が、さがす一覧に大きく出ます。">写真をのせましょう</MockH>
        <MockPhoto h={150} label="🥦" />
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginTop:8 }}>
          <MockPhoto h={70} label="🚜" /><MockPhoto h={70} label="🌾" />
          <div style={{ height:70, borderRadius:12, border:`1.5px dashed #CCC`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, color:"#BBB" }}>＋</div>
        </div>
        <p className="f-sans" style={{ fontSize:11, color:SUB, marginTop:10 }}>3 / 10枚</p>
      </div>
    ) },
  { ch:"求人をつくる", name:"作業の説明", url:"#/work/new/8", act:"当日の流れを自由に書く。写真1枚ずつに説明も付けられる。",
    body: () => (
      <div style={{ padding:16 }}>
        <MockH sub="はじめての人でも様子がわかるように書くと、応募が増えます。">どんな作業か、教えてください</MockH>
        <div style={{ border:`1px solid ${LINE}`, borderRadius:12, padding:12, fontSize:13, color:INK, lineHeight:1.9, minHeight:110 }}>
          朝8時に畑に集合して、ブロッコリーを一つずつ切って、コンテナに入れていきます。慣れれば難しくありません。<br />お昼は12時から1時間、休憩小屋で休みます。
        </div>
        <div style={{ display:"flex", gap:8, marginTop:12 }}>
          <MockPhoto h={54} label="🥦" /><MockPhoto h={54} label="🚜" />
        </div>
        <p className="f-sans" style={{ fontSize:11, color:SUB, marginTop:8 }}>写真を選ぶと、その写真の説明を書けます。</p>
      </div>
    ) },
  { ch:"求人をつくる", name:"危険な場所・作業", url:"#/work/new/9", act:"危ないところを正直に伝える。写真も2枚まで付けられる。",
    body: () => (
      <div style={{ padding:16 }}>
        <MockH sub="安心して働けるよう、危ないところは正直に伝えましょう。">気をつけてほしいこと</MockH>
        <MockCard style={{ marginBottom:10 }}>
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:INK, margin:"0 0 6px" }}>⚠️ 用水路のふち</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.8, margin:"0 0 10px" }}>畑の北側に深さ1mの用水路があります。柵はありません。</p>
          <div style={{ display:"flex", gap:8 }}><MockPhoto h={54} label="📷" /><MockPhoto h={54} label="📷" /></div>
        </MockCard>
        <MockCard>
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:INK, margin:"0 0 6px" }}>⚠️ 収穫ナイフ</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.8, margin:0 }}>よく切れます。手袋をお渡しします。</p>
        </MockCard>
      </div>
    ) },
  { ch:"求人をつくる", name:"働き手への希望", url:"#/work/new/10", act:"必要な経験・持ち物・注意事項を書く。",
    body: () => (
      <div style={{ padding:16 }}>
        <MockH sub="安全への備えは、農家側でご用意・ご対応ください。">働き手におねがいしたいこと</MockH>
        <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:INK, margin:"0 0 8px" }}>必要な経験</p>
        <MockPills items={["未経験OK","少し経験があると助かる","経験者のみ"]} on="未経験OK" />
        <div style={{ height:14 }} />
        <MockField label="持ち物" value="長靴、帽子、飲みもの" />
        <MockField label="注意事項" value="雨の日は前日の夕方に中止のご連絡をします。" />
      </div>
    ) },
  { ch:"求人をつくる", name:"確認", url:"#/work/new/11", act:"求人が働き手にどう見えるかを、そのままの姿で確かめる。行ごとに直せる。",
    body: () => (
      <div style={{ padding:0 }}>
        <MockPhoto h={140} radius={0} label="🥦" />
        <div style={{ padding:14 }}>
          <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:INK, margin:0 }}>ブロッコリー 収穫</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, margin:"4px 0 12px" }}>吉野川市山川町忌部 字前川12-3</p>
          <MockCard style={{ padding:"2px 12px" }}>
            <MockRow l="日程" r="9月10日〜14日（13日休み）" edit />
            <MockRow l="勤務時間" r="8:00〜16:00（休憩60分）" edit />
            <MockRow l="人数" r="3人" edit />
            <MockRow l="報酬" r="日給 9,000円" edit />
            <MockRow l="時間外" r="あり（30分ほど）" edit />
          </MockCard>
        </div>
      </div>
    ) },

  /* ═══ 掲載する ═══ */
  { ch:"掲載する", name:"掲載前のチェック", url:"#/work/new/11", act:"下からせり上がるシートで4つの確認に同意する。ここが掲載の記録になる。",
    body: () => (
      <div style={{ padding:0, position:"relative", minHeight:300, background:"rgba(0,0,0,0.35)" }}>
        <div style={{ position:"absolute", left:10, right:10, bottom:10, background:"#fff", borderRadius:20, padding:16, boxShadow:"0 -6px 24px rgba(0,0,0,0.18)" }}>
          <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:INK, margin:"0 0 12px" }}>掲載する前に、ご確認ください</p>
          {["書いた条件で、そのとおりに働いてもらいます","最低賃金を下回っていません","危ないところは正直に書きました","働き手の安全に配慮します"].map(t => (
            <p key={t} className="f-sans" style={{ fontSize:12, color:INK, lineHeight:1.9, margin:"0 0 6px" }}>☑ {t}</p>
          ))}
          <div style={{ marginTop:12 }}><MockBtn kind="green">同意して掲載する</MockBtn></div>
        </div>
      </div>
    ) },
  { ch:"掲載する", name:"掲載しました", url:"#/profile/employer", act:"ページではなくお祝いの演出が出て、自分の求人の場所に着地する。",
    body: () => (
      <div style={{ padding:"46px 18px", textAlign:"center", background:"#1a1a1a", minHeight:300 }}>
        <div style={{ fontSize:48 }}>🎉</div>
        <p className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#fff", margin:"14px 0 8px" }}>公開しました！</p>
        <p className="f-sans" style={{ fontSize:13, color:"#DDD", lineHeight:1.9, margin:0 }}>働き手に公開されました。<br />さがすに並んでいます。</p>
        <p className="f-sans" style={{ fontSize:11, color:"#888", marginTop:22 }}>✨ 花火の演出（3秒）のあと、自分の求人へ</p>
      </div>
    ) },
  { ch:"掲載する", name:"自分の求人", url:"#/profile/employer", act:"名刺とカード格子。作成中・公開間近・公開中・応募者が一目でわかる。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockCard style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14, borderColor:GREEN }}>
          <MockAvatar label="千" color={GREEN} size={48} />
          <div>
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:INK, margin:0 }}>千歳ファーム</p>
            <p className="f-sans" style={{ fontSize:11, color:SUB, margin:"3px 0 0" }}>吉野川市 ・ 就農16年目</p>
          </div>
        </MockCard>
        <MockCards items={[{ e:"📝", l:"作成中", n:1 }, { e:"🌱", l:"公開間近" }, { e:"📢", l:"公開中", n:2 }, { e:"📨", l:"応募者", n:3 }, { e:"📅", l:"カレンダー" }, { e:"⏰", l:"期限切れ" }]} />
        <div style={{ marginTop:14 }}><MockBtn kind="green">📝 新しく求人を出す</MockBtn></div>
      </div>
    ) },

  /* ═══ 応募がくる ═══ */
  { ch:"応募がくる", name:"新着の応募", url:"#/new-applicants", act:"応募が届くと、サイトを開いた最初にこの画面に着地する。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockCard style={{ padding:0, overflow:"hidden", marginBottom:12 }}>
          <div style={{ display:"flex", gap:10, padding:10 }}>
            <div style={{ width:66, flexShrink:0 }}><MockPhoto h={88} label="🥦" /></div>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <MockAvatar label="は" size={34} />
                <div>
                  <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:INK, margin:0 }}>はなこ さん</p>
                  <MockChip bg="#FFF1E8" fg={ORANGE}>応募中</MockChip>
                </div>
              </div>
              <p className="f-sans" style={{ fontSize:11, color:SUB, margin:"8px 0 0", lineHeight:1.7 }}>ブロッコリー 収穫 #1200<br />来られる日：9/10・9/11・9/12</p>
            </div>
          </div>
          <div style={{ padding:"0 10px 10px" }}><MockBtn>内容を見て決める</MockBtn></div>
        </MockCard>
        <p className="f-sans" style={{ fontSize:11, color:SUB, lineHeight:1.8 }}>承認するか見送るかを決めると、この画面には出なくなります。</p>
      </div>
    ) },
  { ch:"応募がくる", name:"応募者", url:"#/profile/employer/applicants", act:"応募者のプロフィール・信頼情報・はたらいた記録を見て、承認するか決める。",
    body: () => (
      <div style={{ padding:14 }}>
        <div style={{ display:"flex", gap:6, marginBottom:12 }}>
          {["すべて","応募中","面接中","採用","作業中"].map((t, i) => (
            <span key={t} className="f-sans" style={{ padding:"6px 11px", borderRadius:18, fontSize:11, fontWeight:700, border: i === 1 ? `2px solid ${INK}` : `1px solid ${LINE}`, color: i === 1 ? INK : SUB, background:"#fff" }}>{t}</span>
          ))}
        </div>
        <MockCard>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <MockAvatar label="は" size={44} />
            <div style={{ flex:1 }}>
              <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:INK, margin:0 }}>はなこ さん</p>
              <p className="f-sans" style={{ fontSize:11, color:SUB, margin:"3px 0 0" }}>吉野川市 ・ 車で来られます</p>
            </div>
            <MockChip bg="#FFF1E8" fg={ORANGE}>応募中</MockChip>
          </div>
          <div style={{ background:SOFT, borderRadius:12, padding:"10px 12px", marginBottom:10 }}>
            <p className="f-sans" style={{ fontSize:11, color:SUB, lineHeight:1.9, margin:0 }}>働いた回数 12回 ・ 合計 84時間<br />また呼びたい 5件 ・ 直近5件の遅刻 0回</p>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <MockBtn kind="green">承認する</MockBtn>
            <MockBtn kind="ghost">見送る</MockBtn>
          </div>
        </MockCard>
      </div>
    ) },
  { ch:"応募がくる", name:"面接の質問を送る", url:"#/calendar/todo/interview", act:"承認したら、聞きたいことを質問集から選んでチャットに送る。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockH sub="選んだ質問が、そのままチャットに届きます。">はなこ さんに聞きますか？</MockH>
        {["農作業の経験はありますか？","車で来られますか？","当日の集合時間は大丈夫ですか？","持病やけがはありますか？"].map((q, i) => (
          <div key={q} style={{ display:"flex", gap:9, alignItems:"flex-start", padding:"10px 0", borderBottom:`1px solid ${SOFT}` }}>
            <span className="f-sans" style={{ fontSize:13, color: i < 3 ? GREEN : "#CCC" }}>{i < 3 ? "☑" : "☐"}</span>
            <span className="f-sans" style={{ fontSize:13, color:INK, lineHeight:1.7 }}>{q}</span>
          </div>
        ))}
        <div style={{ marginTop:14 }}><MockBtn kind="green">3つの質問を送る</MockBtn></div>
      </div>
    ) },
  { ch:"応募がくる", name:"チャット", url:"#/chat/{id}", act:"働き手と直接やりとりする。求人の状態と採用のボックスが上に出る。",
    body: () => (
      <div style={{ background:SOFT, minHeight:300 }}>
        <MockBar left="←" title="はなこ さん" right="報告" />
        <div style={{ padding:"8px 10px", background:"#fff", borderBottom:`1px solid ${LINE}`, display:"flex", gap:8 }}>
          <div style={{ flex:1, border:`1px solid ${LINE}`, borderRadius:12, padding:"7px 10px" }}>
            <p className="f-sans" style={{ fontSize:11, fontWeight:800, color:INK, margin:0 }}>#1200 ブロッコリー 収穫</p>
            <MockChip bg="#F3E5F5" fg={PURPLE}>面接中</MockChip>
          </div>
        </div>
        <div style={{ padding:12 }}>
          <MockMsg name="ちとせ銀行">はなこ さんの応募を承認しました。打ち合わせをすすめましょう。</MockMsg>
          <MockMsg me>農作業の経験はありますか？</MockMsg>
          <MockMsg name="はなこ">去年、みかんの収穫を10日ほど手伝いました。ブロッコリーははじめてです。</MockMsg>
          <MockMsg me>大丈夫です。当日その場でお教えします。</MockMsg>
        </div>
      </div>
    ) },
  { ch:"応募がくる", name:"採用する", url:"#/calendar/todo/hire", act:"🤝をタップして最終確認。OKで採用が決まり、契約の内容が記録に凍結される。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockCard style={{ display:"flex", gap:0, padding:0, overflow:"hidden", marginBottom:12 }}>
          <div style={{ flex:1 }}><MockPhoto h={92} radius={0} label="🥦" /></div>
          <div style={{ flex:1, padding:"12px 6px", textAlign:"center" }}>
            <MockAvatar label="は" size={36} />
            <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:INK, margin:"6px 0 0" }}>はなこ さん</p>
            <p className="f-sans" style={{ fontSize:10, color:PURPLE, fontWeight:700, margin:"2px 0 0" }}>面接中</p>
          </div>
          <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", borderLeft:`1px solid ${LINE}`, fontSize:26 }}>🤝</div>
        </MockCard>
        <MockCard style={{ borderColor:INK, borderWidth:2 }}>
          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:INK, margin:"0 0 8px" }}>はなこ さんを採用しますか？</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.9, margin:"0 0 12px" }}>9月10日〜12日 ・ 日給9,000円<br />契約が成立すると、お互いの本名が表示されます（雇用の法定手続きのため）。</p>
          <MockBtn kind="green">OK・採用する</MockBtn>
        </MockCard>
      </div>
    ) },

  /* ═══ 仕事の当日 ═══ */
  { ch:"仕事の当日", name:"今日", url:"#/calendar", act:"やることが上から並ぶ。いちばん大事な用件は「いま これだけ」に大きく出る。",
    body: () => (
      <div style={{ padding:14 }}>
        <p className="f-sans" style={{ fontSize:12, fontWeight:800, color:SUB, margin:"0 0 8px" }}>いま これだけ</p>
        <MockCard style={{ borderColor:GREEN, borderWidth:2, marginBottom:16 }}>
          <p className="f-sans" style={{ fontSize:22, margin:0 }}>✓</p>
          <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:INK, margin:"6px 0 4px" }}>作業の開始を確認</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, margin:0 }}>はなこ さんが来ているか確かめて、開始を記録します。</p>
        </MockCard>
        <p className="f-sans" style={{ fontSize:12, fontWeight:800, color:SUB, margin:"0 0 8px" }}>やること</p>
        <MockCards items={[{ e:"📨", l:"新着の応募", n:1 }, { e:"🤝", l:"採用する" }, { e:"🛡", l:"保険の報告", n:1 }, { e:"✓", l:"開始を確認", n:1 }, { e:"✅", l:"完了・評価" }, { e:"📅", l:"カレンダー" }]} />
      </div>
    ) },
  { ch:"仕事の当日", name:"保険の準備の報告", url:"#/calendar/todo/insurance", act:"労災など保険の備えができたと報告する。働き手にも伝わる。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockH sub="事故が起きたときの備えです。働き手にも「準備できました」と伝わります。">保険の準備はできましたか？</MockH>
        <MockCard>
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:INK, margin:"0 0 8px" }}>はなこ さん ・ 9月10日〜</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.9, margin:"0 0 12px" }}>🛡 農作業中の傷害保険に加入しています</p>
          <MockBtn kind="green">準備したと報告</MockBtn>
        </MockCard>
      </div>
    ) },
  { ch:"仕事の当日", name:"作業の開始を確認", url:"#/calendar/todo/confirm_start", act:"当日、働き手が来たことを確かめて開始を記録する（打刻がなくても時刻で自動開始）。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockCard>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <MockAvatar label="は" size={40} />
            <div>
              <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:INK, margin:0 }}>はなこ さん</p>
              <MockChip bg="#E3F2FD" fg={BLUE}>作業中</MockChip>
            </div>
          </div>
          <div style={{ background:SOFT, borderRadius:12, padding:"10px 12px", marginBottom:12 }}>
            <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.9, margin:0 }}>予定 8:00 開始<br />働き手の打刻 7:56（4分前）</p>
          </div>
          <MockBtn kind="green">開始を確認</MockBtn>
        </MockCard>
      </div>
    ) },
  { ch:"仕事の当日", name:"打刻の直しを承認", url:"#/calendar", act:"働き手から打刻の直しの申請が来たら、内容を見て承認する（自分では直せない）。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockCard style={{ borderColor:"#F5A623" }}>
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:INK, margin:"0 0 8px" }}>⏱ 打刻の直しのお願い</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.9, margin:"0 0 12px" }}>はなこ さんから<br />開始 7:56 → 8:00 に直したい<br />理由：着替えの前に押してしまいました</p>
          <div style={{ display:"flex", gap:8 }}>
            <MockBtn kind="green">承認する</MockBtn>
            <MockBtn kind="ghost">ことわる</MockBtn>
          </div>
        </MockCard>
      </div>
    ) },
  { ch:"仕事の当日", name:"緊急連絡", url:"#/calendar/todo/t_emergency", act:"遅刻・欠勤・中止など、当日の急な連絡をする窓口。採用が決まった仕事から使える。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockCard style={{ padding:0, overflow:"hidden", marginBottom:12 }}>
          <div style={{ display:"flex" }}>
            <div style={{ flex:1 }}><MockPhoto h={98} radius={0} label="🥦" /></div>
            <div style={{ flex:1, padding:"14px 6px", textAlign:"center" }}>
              <MockAvatar label="は" size={38} />
              <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:INK, margin:"6px 0 0" }}>はなこ さん</p>
              <p className="f-sans" style={{ fontSize:10, color:BLUE, fontWeight:700, margin:"2px 0 0" }}>作業中</p>
            </div>
          </div>
        </MockCard>
        <MockBtn kind="danger">⚠️ 緊急連絡</MockBtn>
        <p className="f-sans" style={{ fontSize:11, color:SUB, lineHeight:1.8, marginTop:10 }}>相手の緊急連絡先は、採用が決まったあとにだけ表示されます。</p>
      </div>
    ) },

  /* ═══ 完了と評価 ═══ */
  { ch:"完了と評価", name:"完了して評価する", url:"#/calendar/todo/complete", act:"作業が終わったことを記録する。来なかった場合もここで記録する。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockH sub="記録すると、働き手に「おつかれさまでした」が届きます。">作業は終わりましたか？</MockH>
        <MockCard>
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:INK, margin:"0 0 6px" }}>はなこ さん ・ 9月10日</p>
          <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.9, margin:"0 0 12px" }}>8:00 開始 ・ 16:10 終了</p>
          <div style={{ display:"flex", gap:8 }}>
            <MockBtn kind="green">完了として記録</MockBtn>
            <MockBtn kind="ghost">来ませんでした</MockBtn>
          </div>
        </MockCard>
      </div>
    ) },
  { ch:"完了と評価", name:"評価を送る", url:"#/profile/employer/applicants", act:"あてはまる項目を選んで評価する。よかった項目だけが相手に見える。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockH sub="点数はつけません。あてはまるものを選ぶだけです。">はなこ さんはいかがでしたか？</MockH>
        {[["時間どおりに来てくれた", true], ["説明したとおりにできた", true], ["安全に気をつけていた", true], ["また呼びたい", true]].map(([t, on]) => (
          <div key={t} style={{ display:"flex", gap:9, padding:"10px 0", borderBottom:`1px solid ${SOFT}` }}>
            <span className="f-sans" style={{ fontSize:13, color: on ? GREEN : "#CCC" }}>{on ? "☑" : "☐"}</span>
            <span className="f-sans" style={{ fontSize:13, color:INK }}>{t}</span>
          </div>
        ))}
        <div style={{ marginTop:12 }}>
          <MockField label="ひとこと（運営が確認してから公開されます）" value="はじめてとは思えないほど丁寧でした。" />
          <MockBtn kind="green">評価を送る</MockBtn>
        </div>
      </div>
    ) },
  { ch:"完了と評価", name:"はたらいた記録", url:"#/profile/employer/applicants", act:"応募を受けた働き手の、記録から導いた事実だけを見る（点数・順位はつくらない）。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockCard>
          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:INK, margin:"0 0 10px" }}>はなこ さんの はたらいた記録</p>
          <MockRow l="働いた回数" r="13回" />
          <MockRow l="合計の時間" r="91時間" />
          <MockRow l="欠勤" r="0回" />
          <MockRow l="直近5件の遅刻" r="0回" />
          <div style={{ marginTop:10 }}>
            <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:SUB, margin:"0 0 6px" }}>作物別</p>
            <p className="f-sans" style={{ fontSize:12, color:INK, lineHeight:1.9, margin:0 }}>ブロッコリー 6回 ・ みかん 4回 ・ レタス 3回</p>
          </div>
          <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.8, marginTop:12 }}>どの農園で働いたかは表示されません。</p>
        </MockCard>
      </div>
    ) },

  /* ═══ ふだんの道具 ═══ */
  { ch:"ふだんの道具", name:"カレンダー", url:"#/profile/employer/calendar", act:"自分の求人と、決まった働き手の予定を月で見る。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockCard style={{ padding:12, marginBottom:12 }}>
          <p className="f-sans" style={{ fontSize:12, fontWeight:800, color:INK, margin:"0 0 10px" }}>2026年 9月</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
            {["日","月","火","水","木","金","土"].map(d => <div key={d} className="f-sans" style={{ textAlign:"center", fontSize:10, color:SUB }}>{d}</div>)}
            {Array.from({ length:21 }, (_, i) => i + 1).map(d => (
              <div key={d} style={{ textAlign:"center", padding:"5px 0" }}>
                <span className="f-sans" style={{ fontSize:11, color:INK }}>{d}</span>
                {d >= 10 && d <= 14 && d !== 13 && <div style={{ width:5, height:5, borderRadius:"50%", background:GREEN, margin:"2px auto 0" }} />}
              </div>
            ))}
          </div>
          <p className="f-sans" style={{ fontSize:10, color:SUB, margin:"10px 0 0" }}>● 緑＝自分の求人　● 橙＝働き手として行く仕事</p>
        </MockCard>
        <MockCard style={{ borderLeft:`4px solid ${GREEN}` }}>
          <p className="f-sans" style={{ fontSize:12, fontWeight:800, color:INK, margin:0 }}>9月10日 ブロッコリー 収穫</p>
          <p className="f-sans" style={{ fontSize:11, color:SUB, margin:"4px 0 0" }}>8:00〜16:00 ・ はなこ さん</p>
        </MockCard>
      </div>
    ) },
  { ch:"ふだんの道具", name:"道具箱", url:"#/profile/employer", act:"働き手の顔を作る・設定・規約・ログアウト・退会の申し出。",
    body: () => (
      <div style={{ padding:14 }}>
        <MockCard style={{ marginBottom:12, borderColor:ORANGE }}>
          <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:INK, margin:"0 0 4px" }}>🤝 働き手プロフィールを作る</p>
          <p className="f-sans" style={{ fontSize:11, color:SUB, lineHeight:1.8, margin:0 }}>農閑期に、他の農園を手伝うこともできます。</p>
        </MockCard>
        {["アカウントの設定", "通知の設定", "利用規約", "プライバシーポリシー", "ログアウト", "退会の申し出"].map(t => (
          <div key={t} style={{ display:"flex", justifyContent:"space-between", padding:"13px 2px", borderBottom:`1px solid ${SOFT}` }}>
            <span className="f-sans" style={{ fontSize:13, color: t === "退会の申し出" ? RED : INK, fontWeight:600 }}>{t}</span>
            <span style={{ fontSize:13, color:"#C0C0C0" }}>›</span>
          </div>
        ))}
      </div>
    ) },
];

const HASH_BASE = "/admin/farmer-pages";
// URLの末尾の数字（1始まり）＝いま何枚目か。範囲外・数字なしは1枚目に倒す
const readStep = () => {
  try {
    const m = window.location.hash.replace(/^#\/?/, "").match(/^admin\/farmer-pages\/(\d+)/);
    const n = m ? Number(m[1]) : 1;
    return n >= 1 && n <= STEPS.length ? n : 1;
  } catch { return 1; }
};

export function AdminFarmerPagesRoom() {
  const [step, setStep] = useState(readStep);
  // ブラウザの戻る／URL直打ちに追従（URL＝場所の原則。次へ・戻るはhashを書くだけ）
  useEffect(() => {
    const onHash = () => setStep(readStep());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // 画面を送ったら見本の先頭から読める位置へ（長い見本の途中に着地させない）
  useEffect(() => { try { window.scrollTo({ top:0, behavior:"auto" }); } catch { window.scrollTo(0, 0); } }, [step]);

  const go = (n) => { window.location.hash = HASH_BASE + "/" + n; };
  const first = step <= 1, last = step >= STEPS.length;
  // 端でも押せる（タップ不能はやめる・2026-08-03）：最初の「戻る」と最後の「次へ」は管理へ帰る
  const onPrev = () => { if (first) window.location.hash = "/admin"; else go(step - 1); };
  const onNext = () => { if (last) window.location.hash = "/admin"; else go(step + 1); };
  const s = STEPS[step - 1];

  return (
    /* cb-admin-page＝サイトフッターを隠す目印／cb-farmer-walk-page＝下部バーと浮遊☰を
       「戻る／次へ」に差し替える目印（appStyles） */
    <div className="fade-in cb-admin-page cb-farmer-walk-page" style={{ maxWidth:560, margin:"0 auto", padding:"24px 16px 120px" }}>
      <AdminNav current="farmer-pages" />

      {/* いま何章の何枚目か */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <MockChip bg="#EFEFEF" fg={INK}>{s.ch}</MockChip>
        <span className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0" }}>{step} / {STEPS.length}</span>
      </div>
      <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:INK, margin:"0 0 6px" }}>{s.name}</h2>
      <p className="f-sans" style={{ fontSize:12, color:SUB, lineHeight:1.9, margin:"0 0 4px" }}>{s.act}</p>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 14px" }}>{s.url}</p>

      {/* 進み具合（章の切れ目が見えるように、全枚数ぶんの目盛りで示す） */}
      <div style={{ display:"flex", gap:2, marginBottom:16 }}>
        {STEPS.map((_, i) => (
          <div key={i} style={{ flex:1, height:3, borderRadius:2, background: i < step ? INK : "#E8E8E8" }} />
        ))}
      </div>

      {/* 見本の画面（本番の意匠を写した飾り。操作はできない） */}
      <div style={{ border:`1px solid ${LINE}`, borderRadius:22, overflow:"hidden", background:"#fff", boxShadow:"0 6px 24px rgba(0,0,0,0.08)" }}>
        {s.body()}
      </div>

      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.8, marginTop:14 }}>
        この見本の中身はすべて架空です（実在の利用者・求人ではありません）。読むだけのページで、ここからは何も保存されません。
      </p>

      {/* 下部バーの差し替え（戻る／次へ）。この画面では本来の下部バー・浮遊☰は出ない */}
      <div className="cb-walk-bar">
        <button type="button" className="f-sans cb-walk-prev" onClick={onPrev}>{first ? "← 管理へ" : "← 戻る"}</button>
        <span className="f-sans cb-walk-count">{step} / {STEPS.length}</span>
        <button type="button" className="f-sans cb-walk-next" onClick={onNext}>{last ? "おわり" : "次へ →"}</button>
      </div>
    </div>
  );
}
