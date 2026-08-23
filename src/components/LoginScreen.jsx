// 分割3-B（2026-07-25）：App.jsxから移動。メールOTP認証＋パスワードログイン。
// 認証まわりの絶対規則（CLAUDE.md）：OTP・認証コードの取得入力を代行しない。実機検証はユーザー本人。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { C } from "../lib/utils";
import { Dots } from "./ui";
import { NavIcon } from "./NavIcons";

// ── LoginScreen — メールOTP認証 ───────────────────────────────
export function LoginScreen({ farmers, onLogin, onGoRegister }) {
  // 認証の2経路（2026-07-16）：
  // ・既存の方＝メールアドレス＋パスワード（view "login"・デフォルト）
  // ・新規登録＝6桁コード認証→パスワード設定（view "otp"→"code"→"setpw"）
  //   パスワード未設定・忘れた既存の方も同じOTP経路で再設定できる（経路を増やさない）
  const [view,    setView]    = useState("login"); // login | otp | code | setpw
  const [signupOpen, setSignupOpen] = useState(false); // 新規登録の開放（app_settings.signup_open・既定false=招待制）。ONにするのは運営（2026-07-21規約v2/プラポリv2で前提充足）
  useEffect(() => { supabase.rpc("signup_open").then(({ data }) => { if (data === true) setSignupOpen(true); }).catch(()=>{}); }, []);
  const [email,   setEmail]   = useState("");
  const [pw,      setPw]      = useState("");
  const [pw2,     setPw2]     = useState("");
  const [code,    setCode]    = useState("");
  const [authedUser, setAuthedUser] = useState(null); // OTP認証済みユーザー（パスワード設定待ち）
  const [alreadyRegistered, setAlreadyRegistered] = useState(false); // 既にアカウントを持っている人が新規登録から入ってきた（2026-08-01）
  // コードが届かない人の救済（2026-08-04）。認証コードを待たず、パスワードを決めて登録する経路。
  // 背景：Supabase Auth の「メールアドレスの確認」が無効だと、未登録アドレスへの signInWithOtp は
  //   サーバー側でアカウント作成＋確認済みにしてセッションを返すが、supabase-js はその応答を捨てる
  //   （signInWithOtp のメール経路は user/session を必ず null で返す実装）。コードも送られないため、
  //   画面は6桁コードを待ち続け、誰も先へ進めないまま account_holders の無いアカウントだけが残る。
  //   実際に2026-07-27・07-29の2件がこの状態で放置された。
  const [directSignup, setDirectSignup] = useState(false);
  const [sending, setSending] = useState(false);
  const [err,     setErr]     = useState("");
  const [shk,     setShk]     = useState(false);
  const [showPw,  setShowPw]  = useState(false); // パスワードの表示切替（👁タップ）。画面が変わったらモザイクに戻す
  useEffect(() => { setShowPw(false); }, [view]);
  // 運営お知らせ「ログイン方法が変わりました」のリンクから、再設定の入口へその場で切り替える（2026-08-17）。
  // このお知らせは展開機会が login＝#/login でしか出ないため、link_hash="/login" では
  // 「いま見ているページ」へ飛ぶだけの死んだリンクだった。お知らせ台帳の event: 方式
  // （プロフィール入力のお願い＝cb:openConfProfile と同じ作法）に載せ替え、押した先を
  // 実際の動き（view="otp"）にする。中身は「パスワードを忘れた方・未設定の方」ボタンと同一ので
  // 入口が増えても経路は1本のまま
  useEffect(() => {
    const f = () => { setView("otp"); setErr(""); setPw(""); setDirectSignup(false); };
    window.addEventListener("cb:loginResetPw", f);
    return () => window.removeEventListener("cb:loginResetPw", f);
  }, []);
  // パスワード欄の右端に置く👁ボタン（表示中は🙈）。inputはpaddingRightで重なりを避ける
  const eyeBtn = (
    <button type="button" onClick={()=>setShowPw(v=>!v)} tabIndex={-1}
      aria-label={showPw ? "パスワードを隠す" : "パスワードを表示する"}
      style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", padding:4, lineHeight:1, color:"#717171", display:"flex" }}>
      <NavIcon name={showPw ? "eyeOff" : "views"} size={18} />
    </button>
  );

  const bounce = () => { setShk(true); setTimeout(()=>setShk(false),500); };

  // 送信できなかったことは利用者の画面で消えて終わるので、運営が気づけるよう記録に残す。
  // メールアドレスは残さない（誰が試したかは auth のログ側にある）。
  const logMailFailure = (error) => {
    try {
      supabase.from("app_errors").insert({
        level: "error", source: "client", page: "login", component: "LoginScreen",
        action: "requestCode", operation: "auth.signInWithOtp",
        error_code: String(error?.status || error?.code || ""),
        message: String(error?.message || "").slice(0, 500),
        url: window.location.href, user_agent: navigator.userAgent,
      }).then(()=>{}, ()=>{});
    } catch {}
  };

  // 認証成功後の共通処理。既存プロフィールを確認するだけ。作らない・書き換えない。
  // 役割選択ページ(#/role)は撤廃済み＝役割は聞かないアクションベース設計（farmers行あり→農家／無し→最小形の働き手me）
  const completeLogin = async (user) => {
    const normalizedEmail = (user?.email || email).trim().toLowerCase();
    const { data: farmer } = await supabase
      .from("farmers")
      .select("*")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (farmer) {
      onLogin({
        ...farmer,
        id: farmer.auth_id || user.id,
        joinedYear: farmer.joined_year,
        planned_crops: farmer.planned_crops || [],
        sales_channels: farmer.sales_channels || [],
      });
      return;
    }
    // farmers行なし＝働き手または初回。役割は聞かない（アクションベース設計）。
    // 最小形の me でログインさせる。account_holders 未登録なら
    // 既存の needsAccountHolder ゲートが①フォームを自動表示する。
    onLogin({ id: user.id, email: normalizedEmail, name: "", isWorker: true });
  };

  // 既存の方：メールアドレス＋パスワード
  const passwordLogin = async () => {
    setSending(true); setErr("");
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setSending(false);
    if (error) { setErr("メールアドレスまたはパスワードが違います"); bounce(); return; }
    await completeLogin(data.user);
  };

  const requestCode = async () => {
    setSending(true); setErr("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: signupOpen } });
    setSending(false);
    if (error) {
      // 失敗の理由を出し分ける（2026-08-01たきと報告「なぜ？」）。
      // 以前は「招待されていない」以外を全部「メール送信に失敗しました」に丸めていたため、
      // 実際は連打の待ち時間・送信上限でも同じ文言が出て、原因が誰にも分からなかった。
      const msg = String(error.message || "");
      const wait = msg.match(/after (\d+) seconds?/i);            // 同じ宛先への連打（既定60秒）
      const isInviteOnly = /signup/i.test(msg);
      const isRate = /rate limit|too many|only request this after/i.test(msg);
      // サーバー側がメールを出せない状態（SMTPの鍵が無効・送信サービスの障害など）。
      // 利用者が何度やり直しても直らない種類ので「時間をおいて再度」と促さず、運営側の問題だと伝える。
      // 実例：2026-08-04 gomail 550 "API key is invalid"（Supabase Auth のカスタムSMTP）→
      //       画面には英語のまま「詳細: Error sending magic link email」が出ていた。
      const isServerMail = error.status === 500 || /error sending|failed to send|smtp|gomail/i.test(msg);
      setErr(
        isInviteOnly ? "このメールアドレスは招待されていません。招待を受けたアドレスでお試しください"
        : wait       ? `送信の間隔が短すぎます。${wait[1]}秒ほど待ってから、もう一度お試しください`
        : isRate     ? "ただいま送信が混み合っています。しばらく時間をおいてからお試しください"
        : isServerMail ? "ただいま認証コードのメールをお送りできません。お客さまの操作の問題ではなく、運営側の不具合です。復旧までしばらくお待ちください"
        : `メールを送信できませんでした。時間をおいて再度お試しください（詳細：${msg || "不明"}）`
      );
      if (isServerMail) logMailFailure(error);
      return;
    }
    setCode("");
    setDirectSignup(false);
    setView("code");
  };

  const verifyCode = async () => {
    setSending(true); setErr("");
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: 'email',
    });
    setSending(false);
    if (error) { setErr("コードが違います、または有効期限切れです"); setCode(""); bounce(); return; }
    // すでにアカウントを持っている人が、間違えて新規登録から入ってきた場合を見分ける（2026-08-01たきと指示）。
    // 判定は認証を通った"本人"についてだけ行う＝メールアドレスの存在をログイン前に外へ漏らさない。
    //   ①auth.usersの作成時刻が5分以上前＝この操作で作られたのではない
    //   ②account_holders行がある＝当サービスの登録が済んでいる
    let existed = false;
    try {
      const created = data.user?.created_at ? new Date(data.user.created_at).getTime() : 0;
      existed = !!created && (Date.now() - created > 5 * 60 * 1000);
      const { data: ah } = await supabase.from("account_holders").select("id").eq("auth_id", data.user.id).maybeSingle();
      if (ah) existed = true;
    } catch {}
    setAlreadyRegistered(existed);
    // 認証成功→そのままは通さず、パスワード設定へ（次回からメール＋パスワードでログインできるように）
    setAuthedUser(data.user);
    setPw(""); setPw2(""); setErr("");
    setView("setpw");
  };

  // 新規登録（＋パスワード再設定）：OTP認証済みユーザーにパスワードを設定
  const submitPassword = async () => {
    if (pw.length < 8) { setErr("パスワードは8文字以上で設定してください"); return; }
    if (pw !== pw2) { setErr("確認用パスワードが一致しません"); bounce(); return; }
    setSending(true); setErr("");
    // 救済経路：認証コードを受け取っていない＝まだ認証されていないので、更新ではなく新規作成で通す。
    // メールアドレスの確認が無効な設定なら、その場でセッションが返り、メールを1通も受け取らずに登録が済む。
    // 有効な設定に戻したあとは session が返らず「確認メールを送りました」に落ちる＝どちらの設定でも壊れない。
    if (directSignup) {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pw });
      setSending(false);
      if (error) {
        const m = String(error.message || "");
        setErr(/signup/i.test(m)
          ? "このメールアドレスでは新規登録できません。招待を受けたアドレスでお試しください"
          : "登録できませんでした。時間をおいてもう一度お試しください");
        return;
      }
      if (data?.session) { await completeLogin(data.user); return; }
      // identities が空＝すでに登録済みのアドレス（この操作で新しく作られてはいない）
      if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
        setErr("このメールアドレスはすでに登録されています。パスワードをお持ちならログイン画面から、お忘れなら認証コードでの再設定が必要です");
        return;
      }
      setErr("確認メールをお送りしました。メールを開いて確認を済ませてから、ログインしてください");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSending(false);
    if (error) { setErr("パスワードの設定に失敗しました。時間をおいてもう一度お試しください"); return; }
    await completeLogin(authedUser);
  };

  return (
    /* cb-login-page＝下部バーを隠さない目印（2026-07-27たきと指示）。メール欄のautoFocusで
       キーボードを出すと body.cb-typing により下部バーを隠す既定の挙動になっていた。
       ログイン画面では常に表示する（CSSで打ち消し） */
    <div className="fade-in cb-login-page" style={{ minHeight:"80vh",display:"flex",alignItems:"center",justifyContent:"center",padding:28 }}>
      <div style={{ width:"100%",maxWidth:360 }}>
        {/* 旧ブランド「吉野川 農家/YOSHINOGAWA FARMERS」は削除（2026-07-16・前身アプリの遺物） */}
        {/* 🥦は削除・ブランド名は黒文字に統一（2026-07-27たきと指示） */}
        <div style={{ textAlign:"center",marginBottom:40 }}>
          <div className="f-sans" style={{ fontSize:22,fontWeight:800,color:"#222",letterSpacing:".02em" }}>chitose-bank</div>
        </div>

        <div className="ledger-card" style={{ padding:32 }}>
          <div className="f-sans" style={{ fontSize:14,fontWeight:700,color:C.ink,marginBottom:8,letterSpacing:".04em" }}>
            {view === "login" ? "ログイン" : view === "setpw" ? "パスワードの設定" : "新規登録"}
          </div>
          <p className="f-sans" style={{ fontSize:11,color:C.dim,lineHeight:1.7,marginBottom:24 }}>{signupOpen ? "メールアドレスで登録・ログインできます" : "招待制で運営しています"}</p>

          {view === "login" ? (
            /* ── 既存の方：メールアドレス＋パスワード ── */
            <div className="fade-in">
              <div style={{ marginBottom:16 }}>
                <label className="lbl f-sans">メールアドレス</label>
                <input className="field f-sans" type="email" placeholder="your@email.com"
                  value={email} autoFocus
                  onChange={e=>{setEmail(e.target.value);setErr("");}}/>
              </div>
              <div style={{ marginBottom:20 }}>
                <label className="lbl f-sans">パスワード</label>
                <div style={{ position:"relative" }}>
                  <input className={`field f-sans ${shk?"shake":""}`} type={showPw?"text":"password"} placeholder="パスワード" autoComplete="current-password"
                    value={pw} style={{ paddingRight:44 }}
                    onChange={e=>{setPw(e.target.value);setErr("");}}
                    onKeyDown={e=>e.key==="Enter"&&email.trim()&&pw&&!sending&&passwordLogin()}/>
                  {eyeBtn}
                </div>
                {err&&<p className="f-sans" style={{ marginTop:6,fontSize:11,color:C.shu }}>{err}</p>}
              </div>
              <button className="btn-primary" style={{ width:"100%" }}
                disabled={!email.trim()||!pw||sending} onClick={passwordLogin}>
                {sending ? <>確認中<Dots /></> : "ログイン"}
              </button>
              <div style={{ textAlign:"center", marginTop:18, display:"flex", flexDirection:"column", gap:8 }}>
                <button onClick={()=>{setView("otp");setErr("");setPw("");setDirectSignup(false);}} className="f-sans cb-hop"
                  style={{ background:"none",border:"none",fontSize:12,fontWeight:700,color:"#00A86B",textDecoration:"underline",textUnderlineOffset:3,cursor:"pointer" }}>
                  はじめての方はこちら（新規登録）
                </button>
                <button onClick={()=>{setView("otp");setErr("");setPw("");setDirectSignup(false);}} className="f-sans"
                  style={{ background:"none",border:"none",fontSize:11,color:C.dim,textDecoration:"underline",textUnderlineOffset:3,cursor:"pointer" }}>
                  パスワードを忘れた方・未設定の方（6桁コードで再設定）
                </button>
              </div>
            </div>
          ) : view === "otp" ? (
            /* ── 新規登録①：メールアドレス→6桁コード送信 ── */
            <div className="fade-in">
              {/* すでに持っている人が間違えて新規登録に入ることがあるので先に伝える（2026-08-01たきと指示）。
                  ここでは「そのアドレスが登録済みか」は出さない＝ログイン前にアカウントの有無を漏らさない */}
              <p className="f-sans" style={{ fontSize:11, color:C.dim, lineHeight:1.8, marginBottom:14, background:"#F7F7F7", borderRadius:8, padding:"10px 12px" }}>
                すでにアカウントをお持ちの方も、この画面から同じメールアドレスでログインできます。<br/>
                アカウントが二重に作られることはありません。
              </p>
              <div style={{ marginBottom:20 }}>
                <label className="lbl f-sans">メールアドレス</label>
                <input className="field f-sans" type="email" placeholder="your@email.com"
                  value={email} autoFocus
                  onChange={e=>{setEmail(e.target.value);setErr("");}}
                  onKeyDown={e=>e.key==="Enter"&&email.trim()&&!sending&&requestCode()}/>
                {err&&<p className="f-sans" style={{ marginTop:6,fontSize:11,color:C.shu }}>{err}</p>}
              </div>
              <button className="btn-primary" style={{ width:"100%",position:"relative" }}
                disabled={!email.trim()||sending} onClick={requestCode}>
                {sending
                  ? <span style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
                      <span style={{ width:12,height:12,borderRadius:"50%",border:`2px solid ${C.washi}`,borderTopColor:"transparent",display:"inline-block",animation:"spin .8s linear infinite" }}/>
                      送信中<Dots />
                    </span>
                  : "認証コードを送信する →"}
              </button>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              <div style={{ textAlign:"center", marginTop:18 }}>
                <button onClick={()=>{setView("login");setErr("");setDirectSignup(false);}} className="f-sans"
                  style={{ background:"none",border:"none",fontSize:11,color:C.dim,textDecoration:"underline",textUnderlineOffset:3,cursor:"pointer" }}>
                  ← 登録済みの方はこちら（メールアドレスとパスワード）
                </button>
              </div>
            </div>
          ) : view === "code" ? (
            /* ── 新規登録②：6桁コード入力 ── */
            <div className="fade-in">
              <div style={{ padding:"12px 14px",background:C.bambooPl,borderRadius:8,border:`1px solid ${C.bamboo}22`,marginBottom:18 }}>
                <p className="f-sans" style={{ fontSize:11,color:C.bamboo,lineHeight:1.8 }}>
                  <strong>{email}</strong> に6桁のコードを送信しました。<br/>
                  メールを確認してコードを入力してください。<br/>
                  <span style={{ fontSize:10,color:C.dim }}>有効期限：10分</span>
                </p>
              </div>
              <div style={{ marginBottom:20 }}>
                <label className="lbl f-sans">認証コード（6桁）</label>
                <input className={`field f-mono ${shk?"shake":""}`}
                  type="text" inputMode="numeric" maxLength={6} placeholder="000000"
                  value={code} autoFocus
                  onChange={e=>{setCode(e.target.value.replace(/\D/g,"").slice(0,6));setErr("");}}
                  onKeyDown={e=>e.key==="Enter"&&code.length===6&&verifyCode()}
                  style={{
                    fontSize:28,textAlign:"center",letterSpacing:".5em",
                    borderColor:err?C.shu:undefined,
                    background:err?C.shuPl:undefined,
                  }}/>
                {err&&<p className="f-sans" style={{ marginTop:6,fontSize:11,color:C.shu }}>{err}</p>}
              </div>
              <button className="btn-primary" style={{ width:"100%",marginBottom:10 }}
                disabled={code.length!==6||sending} onClick={verifyCode}>
                認証する
              </button>
              <button onClick={()=>{setView("otp");setCode("");setErr("");setDirectSignup(false);}} className="f-sans"
                style={{ width:"100%",background:"none",border:"none",fontSize:11,color:C.dim,textDecoration:"underline",textUnderlineOffset:3 }}>
                ← メールアドレスを変更する
              </button>
              {/* 行き止まり防止（2026-08-04）。誰にでも同じように出す＝このボタンの有無で
                  アドレスが登録済みかどうかは分からない（登録の有無をログイン前に漏らさない原則を維持） */}
              <div style={{ marginTop:14, paddingTop:14, borderTop:"1px solid #EEE", textAlign:"center" }}>
                <button onClick={()=>{setDirectSignup(true);setAlreadyRegistered(false);setAuthedUser(null);setPw("");setPw2("");setErr("");setView("setpw");}}
                  className="f-sans"
                  style={{ background:"none",border:"none",fontSize:12,fontWeight:700,color:"#00A86B",textDecoration:"underline",textUnderlineOffset:3,cursor:"pointer" }}>
                  コードが届かない場合はこちら
                </button>
                <p className="f-sans" style={{ marginTop:6,fontSize:10,color:C.dim,lineHeight:1.7 }}>
                  迷惑メールもご確認ください。それでも届かないときは、パスワードを決めて登録できます
                </p>
              </div>
            </div>
          ) : (
            /* ── 新規登録③：パスワード設定（次回からメール＋パスワードでログイン） ── */
            <div className="fade-in">
              {/* すでにアカウントを持っていた人には、その旨をはっきり出す（2026-08-01たきと指示）。
                  新しく作られていないこと・パスワードは設定し直せることを明記し、そのまま進む道も用意する */}
              {directSignup ? (
                <div style={{ padding:"12px 14px",background:C.bambooPl,borderRadius:8,border:`1px solid ${C.bamboo}22`,marginBottom:18 }}>
                  <p className="f-sans" style={{ fontSize:11,color:C.bamboo,lineHeight:1.8 }}>
                    認証コードを待たずに登録します。<br/>
                    パスワードを決めると、そのまま登録が完了します。
                  </p>
                </div>
              ) : alreadyRegistered ? (
                <div style={{ padding:"12px 14px",background:"#FFF8E7",borderRadius:8,border:"1px solid #F0E0B8",marginBottom:18 }}>
                  <p className="f-sans" style={{ fontSize:12,color:"#8A6D1D",lineHeight:1.9 }}>
                    <strong>このメールアドレスのアカウントは、すでにお持ちです。</strong><br/>
                    新しく作られてはいません。いまログインした状態です。<br/>
                    パスワードを忘れた場合は、ここで設定し直せます。
                  </p>
                </div>
              ) : (
                <div style={{ padding:"12px 14px",background:C.bambooPl,borderRadius:8,border:`1px solid ${C.bamboo}22`,marginBottom:18 }}>
                  <p className="f-sans" style={{ fontSize:11,color:C.bamboo,lineHeight:1.8 }}>
                    メールの確認ができました。<br/>
                    次回からのログインに使うパスワードを設定してください。
                  </p>
                </div>
              )}
              <div style={{ marginBottom:16 }}>
                <label className="lbl f-sans">パスワード（8文字以上）</label>
                <div style={{ position:"relative" }}>
                  <input className="field f-sans" type={showPw?"text":"password"} autoComplete="new-password" placeholder="8文字以上"
                    value={pw} autoFocus style={{ paddingRight:44 }}
                    onChange={e=>{setPw(e.target.value);setErr("");}}/>
                  {eyeBtn}
                </div>
              </div>
              <div style={{ marginBottom:20 }}>
                <label className="lbl f-sans">パスワード（確認用）</label>
                <div style={{ position:"relative" }}>
                  <input className={`field f-sans ${shk?"shake":""}`} type={showPw?"text":"password"} autoComplete="new-password" placeholder="もう一度入力"
                    value={pw2} style={{ paddingRight:44 }}
                    onChange={e=>{setPw2(e.target.value);setErr("");}}
                    onKeyDown={e=>e.key==="Enter"&&pw&&pw2&&!sending&&submitPassword()}/>
                  {eyeBtn}
                </div>
                {err&&<p className="f-sans" style={{ marginTop:6,fontSize:11,color:C.shu }}>{err}</p>}
              </div>
              <button className="btn-primary" style={{ width:"100%" }}
                disabled={!pw||!pw2||sending} onClick={submitPassword}>
                {sending ? <>設定中<Dots /></> : directSignup ? "登録してはじめる" : alreadyRegistered ? "パスワードを設定し直す" : "設定してはじめる"}
              </button>
              {directSignup && (
                <div style={{ textAlign:"center", marginTop:16 }}>
                  <button onClick={()=>{setDirectSignup(false);setErr("");setView("code");}} disabled={sending} className="f-sans"
                    style={{ background:"none",border:"none",fontSize:11,color:C.dim,textDecoration:"underline",textUnderlineOffset:3,cursor:"pointer" }}>
                    ← 認証コードの入力に戻る
                  </button>
                </div>
              )}
              {/* 既存アカウントの人は、パスワードを変えずにそのまま入れる道を残す */}
              {alreadyRegistered && (
                <div style={{ textAlign:"center", marginTop:16 }}>
                  <button onClick={()=>completeLogin(authedUser)} disabled={sending} className="f-sans"
                    style={{ background:"none",border:"none",fontSize:12,color:C.dim,textDecoration:"underline",textUnderlineOffset:3,cursor:"pointer" }}>
                    パスワードは変えずに、このまま続ける →
                  </button>
                </div>
              )}
            </div>
          )}

          {(view === "otp" || view === "code") && (
            <div style={{ textAlign:"center", marginTop:22 }}>
              <p className="f-sans" style={{ fontSize:11, color:C.dim, lineHeight:1.8 }}>
                招待を受けた方のメールアドレスを入力して、認証コードを送信してください。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
