// 分割3-B（2026-07-25）：App.jsxから移動。メールOTP認証＋パスワードログイン。
// 認証まわりの絶対規則（CLAUDE.md）：OTP・認証コードの取得入力を代行しない。実機検証はユーザー本人。
import { useState, useEffect, useId, useRef } from "react";
import { supabase } from "../lib/supabase";
import { Dots } from "./ui";
import { NavIcon } from "./NavIcons";
import "./auth.css";

// ── LoginScreen — メールOTP認証 ───────────────────────────────
export function LoginScreen({ onLogin, embedded = false, onClose }) {
  // 認証の2経路（2026-07-16）：
  // ・既存の方＝メールアドレス＋パスワード（view "login"・デフォルト）
  // ・新規登録＝6桁コード認証→本人の登録情報を確認→未登録ならパスワード設定、登録済みならログイン
  //   パスワード未設定・忘れた既存の方も同じOTP経路で再設定できる（経路を増やさない）
  const fieldId = useId();
  const requestLock = useRef(false);
  const headingRef = useRef(null);
  const previousView = useRef("login");
  const [intent, setIntent] = useState("signup");
  const [resendAt, setResendAt] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [resent, setResent] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const [view,    setView]    = useState("login"); // login | otp | code | verified | welcome | setpw | ready
  const [signupOpen, setSignupOpen] = useState(false); // 新規登録の開放（app_settings.signup_open・既定false=招待制）。ONにするのは運営（2026-07-21規約v2/プラポリv2で前提充足）
  useEffect(() => { supabase.rpc("signup_open").then(({ data }) => { if (data === true) setSignupOpen(true); }).catch(()=>{}); }, []);
  const [email,   setEmail]   = useState("");
  const [pw,      setPw]      = useState("");
  const [pw2,     setPw2]     = useState("");
  const [code,    setCode]    = useState("");
  const [authedUser, setAuthedUser] = useState(null); // OTP認証済みユーザー（パスワード設定待ち）
  const [alreadyRegistered, setAlreadyRegistered] = useState(false); // 既にアカウントを持っている人が新規登録から入ってきた（2026-08-01）
  const [sending, setSending] = useState(false);
  const [err,     setErr]     = useState("");
  const [shk,     setShk]     = useState(false);
  const [showPw,  setShowPw]  = useState(false); // パスワードの表示切替（👁タップ）。画面が変わったらモザイクに戻す
  useEffect(() => {
    setShowPw(false);
    if (previousView.current !== view) headingRef.current?.focus({ preventScroll: true });
    previousView.current = view;
  }, [view]);
  useEffect(() => {
    if (!resendAt) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
      setResendSeconds(remaining);
      if (remaining === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);
  // 運営お知らせ「ログイン方法が変わりました」のリンクから、再設定の入口へその場で切り替える（2026-08-17）。
  // このお知らせは展開機会が login＝#/login でしか出ないため、link_hash="/login" では
  // 「いま見ているページ」へ飛ぶだけの死んだリンクだった。お知らせ台帳の event: 方式
  // （プロフィール入力のお願い＝cb:openConfProfile と同じ作法）に載せ替え、押した先を
  // 実際の動き（view="otp"）にする。中身は「パスワードを忘れた方・未設定の方」ボタンと同一ので
  // 入口が増えても経路は1本のまま
  useEffect(() => {
    const f = () => {
      if (requestLock.current) return;
      setIntent("reset"); setView("otp"); setErr(""); setPw(""); setPw2("");
      setCode(""); setAuthedUser(null); setAlreadyRegistered(false);
    };
    window.addEventListener("cb:loginResetPw", f);
    return () => window.removeEventListener("cb:loginResetPw", f);
  }, []);
  const eyeBtn = (
    <button type="button" onClick={() => setShowPw(v => !v)} className="cb-auth-eye"
      aria-label={showPw ? "パスワードを隠す" : "パスワードを表示する"} aria-pressed={showPw}>
      <NavIcon name={showPw ? "eyeOff" : "views"} size={20} />
    </button>
  );

  // すべての送信を同じ入口に通し、Enterとタップの重複送信・通信例外による行き止まりを防ぐ。
  const runAction = async (action) => {
    if (requestLock.current) return;
    requestLock.current = true;
    setSending(true); setErr("");
    try { await action(); }
    catch { setErr("通信できませんでした。接続を確認して、もう一度お試しください"); }
    finally { requestLock.current = false; setSending(false); }
  };
  const openEmail = (nextIntent) => {
    setIntent(nextIntent); setView("otp"); setErr(""); setPw(""); setPw2("");
    setCode(""); setResent(false); setAuthedUser(null); setAlreadyRegistered(false);
  };
  const openLogin = () => {
    // 入力したメールアドレスは引き継ぐ。ここでは存在確認やメール送信をしない。
    setView("login"); setErr(""); setCode(""); setPw(""); setPw2(""); setResent(false);
  };
  const goBack = () => {
    setErr(""); setCode(""); setPw(""); setPw2(""); setResent(false);
    setView(view === "otp" ? "login" : view === "setpw" ? "welcome" : "otp");
  };

  const bounce = () => { setShk(true); setTimeout(()=>setShk(false),500); };

  // 送信できなかったことは利用者の画面で消えて終わるので、運営が気づけるよう記録に残す。
  // メールアドレスは残さない（誰が試したかは auth のログ側にある）。
  const logMailFailure = (error) => {
    try {
      supabase.from("app_errors").insert({
        level: "error", source: "client", page: "login", component: "LoginScreen",
        action: "requestCode", operation: "auth.signInWithOtp",
        error_code: String(error?.code || error?.status || error?.name || "unknown").slice(0, 80),
        message: "認証コードの送信要求に失敗しました",
        url: window.location.origin + window.location.pathname + "#/login", user_agent: navigator.userAgent,
      }).then(()=>{}, ()=>{});
    } catch {}
  };

  // 認証成功後の共通処理。既存プロフィールを確認するだけ。作らない・書き換えない。
  // 役割選択ページ(#/role)は撤廃済み＝役割は聞かないアクションベース設計（farmers行あり→農家／無し→最小形の働き手me）
  const completeLogin = async (user) => {
    const normalizedEmail = (user?.email || email).trim().toLowerCase();
    const { data: farmer, error } = await supabase
      .from("farmers")
      .select("*")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (error) throw error;
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
    // 「一度失敗して、もう一度で入れる」の正体（2026-09-09たきと報告）：
    //   資格の誤りは status 400（invalid_credentials）だけ。通信・タイムアウト・混雑・コールドスタートは
    //   status が無い／429／5xx になる。旧実装はどの失敗も「パスワードが違います」に丸めていたため、
    //   起動直後の最初の認証リクエスト（nano のコールドスパイク・15秒タイムアウトで一時失敗しやすい・CLAUDE.md）が
    //   正しく入力した人にも「間違い」と出て、赤ちゃん想定の利用者が諦めていた。
    //   → 資格エラー以外は一度だけ静かに再試行する（＝1回目のタップで入れる）。それでも駄目なら理由を出し分ける。
    const isBadCred = (e) => !!e && (e.status === 400 || /invalid.?credentials|invalid login|invalid_grant/i.test(String(e.message || e.code || "")));
    let { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error && !isBadCred(error)) {
      ({ data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw }));
    }
    if (error) {
      setErr(isBadCred(error) ? "メールアドレスまたはパスワードが違います" : "通信が不安定です。もう一度お試しください");
      bounce(); return;
    }
    await completeLogin(data.user);
  };

  const requestCode = async () => {
    let result;
    try {
      result = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: intent === "signup" && signupOpen } });
    } catch (error) {
      logMailFailure(error);
      throw error;
    }
    const { error } = result;
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
      const isConnection = !error.status || [502, 503, 504].includes(error.status);
      setErr(
        isInviteOnly ? (intent === "reset"
          ? "確認コードをお送りできません。登録時のメールアドレスをご確認ください"
          : "このメールアドレスは招待されていません。招待を受けたアドレスでお試しください")
        : wait       ? `送信の間隔が短すぎます。${wait[1]}秒ほど待ってから、もう一度お試しください`
        : isRate     ? "ただいま送信が混み合っています。しばらく時間をおいてからお試しください"
        : isServerMail ? "ただいま認証コードのメールをお送りできません。お客さまの操作の問題ではなく、運営側の不具合です。復旧までしばらくお待ちください"
        : isConnection ? "通信が完了せず、メールを送信できたか確認できません。届いていない場合は、接続を確認してもう一度お試しください"
        : `メールを送信できませんでした。時間をおいて再度お試しください（詳細：${msg || "不明"}）`
      );
      logMailFailure(error);
      return;
    }
    setCode("");
    setResent(view === "code");
    setResendAt(Date.now() + 60000);
    setResendSeconds(60);
    setView("code");
  };

  const continueAfterVerification = async (user) => {
    if (intent === "reset") { setView("setpw"); return; }
    // 登録済みかどうかは、コード認証後に本人の登録情報だけで判断する。
    // 作成からの経過時間では判断しない。未完了の新規登録を「登録済み」と誤案内してしまう。
    try {
      const { data, error } = await supabase.from("account_holders").select("id").eq("auth_id", user.id).maybeSingle();
      if (error) throw error;
      setAlreadyRegistered(!!data);
      setView(data ? "welcome" : "setpw");
    } catch {
      setErr("登録情報を確認できませんでした。メールの確認は済んでいます。もう一度お試しください");
    }
  };

  const verifyCode = async () => {
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: 'email',
    });
    if (error) { setErr("コードが違います、または有効期限切れです"); setCode(""); bounce(); return; }
    setAuthedUser(data.user);
    setPw(""); setPw2(""); setCode(""); setErr("");
    setView("verified");
    await continueAfterVerification(data.user);
  };

  // 新規登録（＋パスワード再設定）：OTP認証済みユーザーにパスワードを設定
  const submitPassword = async () => {
    if (pw.length < 8) { setErr("パスワードは8文字以上で設定してください"); return; }
    if (pw !== pw2) { setErr("確認用パスワードが一致しません"); bounce(); return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setErr("パスワードの設定に失敗しました。時間をおいてもう一度お試しください"); return; }
    // パスワード保存後のプロフィール取得だけが失敗しても、同じ変更を再送しない。
    setPw(""); setPw2(""); setView("ready");
    await completeLogin(authedUser);
  };

  const isReset = intent === "reset";
  const title = view === "login" ? "ログインまたは新規登録"
    : view === "otp" ? (isReset ? "パスワードの再設定" : "新規登録")
    : view === "code" || view === "verified" ? "メールアドレスの確認"
    : view === "welcome" || view === "ready" ? "ログイン" : isReset ? "パスワードの再設定" : "パスワードの設定";
  const heading = view === "login" ? "chitose-bankへようこそ"
    : view === "otp" ? "メールアドレスを入力"
    : view === "code" ? "メールを確認してください"
    : view === "verified" ? "メールアドレスを確認しました"
    : view === "welcome" ? "おかえりなさい"
    : view === "ready" ? "パスワードを設定しました"
    : isReset ? "パスワードを再設定" : "パスワードを設定";
  const hasBack = view === "otp" || view === "code" || (view === "setpw" && alreadyRegistered);
  const errorId = `${fieldId}-error`;
  const emailId = `${fieldId}-email`;
  const pwId = `${fieldId}-password`;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const loginAlternative = (
    <section className="cb-auth-alternative" aria-labelledby={`${fieldId}-alternative`}>
      <h2 id={`${fieldId}-alternative`}>すでにアカウントをお持ちですか？</h2>
      <p>パスワードをお持ちなら、メールを待たずにログインできます。</p>
      <button type="button" className="cb-auth-secondary" disabled={sending} onClick={openLogin}>パスワードでログイン</button>
    </section>
  );

  return (
    <div className={`cb-auth-page cb-login-page f-sans${embedded ? " cb-auth-embedded" : ""}`}>
      <section className="cb-auth-panel" aria-label={title}>
        <header className="cb-auth-header">
          {hasBack ? (
            <button type="button" className="cb-auth-back" onClick={goBack} disabled={sending} aria-label="前の画面に戻る">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
            </button>
          ) : onClose ? (
            <button type="button" className="cb-auth-back" onClick={onClose} disabled={sending} aria-label="ログイン画面を閉じる"><NavIcon name="close" size={18} /></button>
          ) : null}
          <p>{title}</p>
        </header>
        <div className="cb-auth-body cb-auth-enter" key={view}>
          <h1 className="cb-auth-heading" ref={headingRef} tabIndex={-1}>{heading}</h1>
          {view === "login" ? (
            <>
              <p className="cb-auth-description">登録済みの方はこちらからログインできます。</p>
              <form onSubmit={e => { e.preventDefault(); if (validEmail && pw) runAction(passwordLogin); }} aria-busy={sending}>
                <div className="cb-auth-field-group">
                  <div className="cb-auth-field">
                    <label htmlFor={emailId}>メールアドレス</label>
                    <input id={emailId} data-guide="login-email" type="email" name="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                      placeholder="メールアドレスを入力" value={email} required readOnly={sending}
                      onChange={e => { setEmail(e.target.value); setErr(""); }} />
                  </div>
                  <div className={`cb-auth-field cb-auth-password${shk ? " shake" : ""}`}>
                    <label htmlFor={pwId}>パスワード</label>
                    <input id={pwId} type={showPw ? "text" : "password"} name="password" autoComplete="current-password"
                      placeholder="パスワードを入力" value={pw} required readOnly={sending} aria-describedby={err ? errorId : undefined}
                      onChange={e => { setPw(e.target.value); setErr(""); }} />
                    {eyeBtn}
                  </div>
                </div>
                {err && <p id={errorId} className="cb-auth-error" role="alert">{err}</p>}
                <button className="cb-auth-primary" disabled={!validEmail || !pw || sending}>
                  {sending ? <>確認中<Dots /></> : "ログイン"}
                </button>
              </form>
              <button type="button" className="cb-auth-link cb-auth-recovery" disabled={sending} onClick={() => openEmail("reset")}>
                パスワードを忘れた方・未設定の方
              </button>
              <div className="cb-auth-divider"><span>はじめてご利用の方</span></div>
              <button type="button" data-guide="login-signup" className="cb-auth-secondary" disabled={sending} onClick={() => openEmail("signup")}>
                新規登録
              </button>
              {!signupOpen && <p className="cb-auth-note cb-auth-center">現在は招待を受けた方にご利用いただけます。</p>}
            </>
          ) : view === "otp" ? (
            <>
              <p className="cb-auth-description">{isReset ? "登録したメールアドレスに、確認コードをお送りします。" : signupOpen ? "確認コードをお送りします。" : "招待を受けたメールアドレスに、確認コードをお送りします。"}</p>
              <form onSubmit={e => { e.preventDefault(); if (validEmail) runAction(requestCode); }} aria-busy={sending}>
                <div className="cb-auth-field">
                  <label htmlFor={emailId}>メールアドレス</label>
                  <input id={emailId} type="email" name="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                    placeholder="メールアドレスを入力" value={email} required readOnly={sending} aria-invalid={!!err} aria-describedby={err ? errorId : undefined}
                    onChange={e => { setEmail(e.target.value); setErr(""); }} />
                </div>
                {err && <p id={errorId} className="cb-auth-error" role="alert">{err}</p>}
                <button className="cb-auth-primary" disabled={!validEmail || sending}>{sending ? <>送信中<Dots /></> : "続ける"}</button>
              </form>
              {loginAlternative}
            </>
          ) : view === "code" ? (
            <>
              <p className="cb-auth-description cb-auth-recipient"><strong>{email.trim()}</strong> に送信した6桁のコードを入力してください。</p>
              <button type="button" className="cb-auth-link cb-auth-change-email" disabled={sending} onClick={goBack}>メールアドレスを変更</button>
              <form onSubmit={e => { e.preventDefault(); if (code.length === 6) runAction(verifyCode); }} aria-busy={sending}>
                <label className="cb-auth-code-label" htmlFor={`${fieldId}-code`}>認証コード</label>
                <div className={`cb-auth-code${err ? " has-error" : ""}${shk ? " shake" : ""}`}>
                  <input id={`${fieldId}-code`} className="cb-auth-code-input" type="text" name="code" inputMode="numeric" autoComplete="one-time-code"
                    maxLength={6} pattern="[0-9]{6}" required value={code} readOnly={sending} aria-invalid={!!err}
                    aria-describedby={err ? errorId : undefined} aria-label="認証コード（6桁）"
                    onFocus={() => setCodeFocused(true)} onBlur={() => setCodeFocused(false)}
                    onPaste={e => {
                      e.preventDefault();
                      if (sending) return;
                      setCode(e.clipboardData.getData("text").replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0)).replace(/\D/g, "").slice(0, 6));
                      setErr("");
                    }}
                    onChange={e => { setCode(e.target.value.replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0)).replace(/\D/g, "").slice(0, 6)); setErr(""); }} />
                  <div className="cb-auth-code-slots" aria-hidden="true">
                    {Array.from({ length: 6 }, (_, i) => <span key={i} className={codeFocused && i === Math.min(code.length, 5) ? "is-active" : ""}>{code[i] || ""}</span>)}
                  </div>
                </div>
                {err && <p id={errorId} className="cb-auth-error" role="alert">{err}</p>}
                <button className="cb-auth-primary" disabled={code.length !== 6 || sending}>{sending ? <>確認中<Dots /></> : "確認して続ける"}</button>
              </form>
              <div className="cb-auth-resend">
                <span>コードが届きませんか？</span>
                <button type="button" className="cb-auth-link" disabled={sending || resendSeconds > 0} onClick={() => runAction(requestCode)}>
                  {resendSeconds > 0 ? `再送信（あと${resendSeconds}秒）` : "コードを再送信"}
                </button>
              </div>
              {resent && <p className="cb-auth-note" role="status">新しいコードを送信しました。</p>}
              {loginAlternative}
              <details className="cb-auth-help">
                <summary>それでも届かない場合</summary>
                <p>入力したメールアドレスと迷惑メールフォルダをご確認ください。同じメールアドレスで再送信できます。新しく登録し直す必要はありません。</p>
              </details>
            </>
          ) : view === "verified" ? (
            <>
              {err ? <p id={errorId} className="cb-auth-error" role="alert">{err}</p>
                : <p className="cb-auth-description" role="status">登録情報を確認しています<Dots /></p>}
              <button type="button" className="cb-auth-primary" disabled={sending}
                onClick={() => runAction(() => continueAfterVerification(authedUser))}>
                {sending ? <>確認中<Dots /></> : "もう一度確認する"}
              </button>
            </>
          ) : view === "welcome" || view === "ready" ? (
            <>
              <p className="cb-auth-description">{view === "welcome"
                ? "登録済みのアカウントを確認しました。新しく登録する必要はありません。"
                : "設定は完了しています。ログインして続けてください。"}</p>
              <p className="cb-auth-account-email">{email.trim()}</p>
              {err && <p id={errorId} className="cb-auth-error" role="alert">{err}</p>}
              <button type="button" className="cb-auth-primary" disabled={sending}
                onClick={() => runAction(() => completeLogin(authedUser))}>
                {sending ? <>ログイン中<Dots /></> : "ログインして続ける"}
              </button>
              {view === "welcome" && <button type="button" className="cb-auth-link cb-auth-recovery" disabled={sending}
                onClick={() => { setIntent("reset"); setErr(""); setView("setpw"); }}>
                パスワードを再設定する
              </button>}
            </>
          ) : (
            <>
              <p className="cb-auth-description">{isReset ? "メールアドレスを確認しました。次回から使う新しいパスワードを決めてください。"
                : "メールアドレスを確認しました。次回のログインに使うパスワードを決めてください。"}</p>
              <form onSubmit={e => { e.preventDefault(); if (pw.length >= 8 && pw2) runAction(submitPassword); }} aria-busy={sending}>
                <div className="cb-auth-field-group">
                  <div className="cb-auth-field cb-auth-password">
                    <label htmlFor={pwId}>パスワード</label>
                    <input id={pwId} type={showPw ? "text" : "password"} name="new-password" autoComplete="new-password" placeholder="8文字以上" minLength={8} required
                      value={pw} readOnly={sending} onChange={e => { setPw(e.target.value); setErr(""); }} />
                    {eyeBtn}
                  </div>
                  <div className={`cb-auth-field cb-auth-password${shk ? " shake" : ""}`}>
                    <label htmlFor={`${pwId}-confirm`}>パスワード（確認用）</label>
                    <input id={`${pwId}-confirm`} type={showPw ? "text" : "password"} name="confirm-password" autoComplete="new-password" placeholder="もう一度入力" minLength={8} required
                      value={pw2} readOnly={sending} aria-describedby={err ? errorId : undefined}
                      onChange={e => { setPw2(e.target.value); setErr(""); }} />
                    {eyeBtn}
                  </div>
                </div>
                {err && <p id={errorId} className="cb-auth-error" role="alert">{err}</p>}
                <button className="cb-auth-primary" disabled={pw.length < 8 || pw2.length < 8 || sending}>
                  {sending ? <>設定中<Dots /></> : isReset ? "変更してログイン" : "設定して続ける"}
                </button>
              </form>
              {isReset && <button type="button" className="cb-auth-link cb-auth-recovery" disabled={sending} onClick={() => runAction(() => completeLogin(authedUser))}>パスワードを変更せずログイン</button>}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
