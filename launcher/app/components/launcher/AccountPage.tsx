import {useCallback, useEffect, useRef, useState, type ComponentType, type FormEvent} from 'react';
import {useSearchParams} from 'react-router';
import {AppLink} from './AppLink';
import backgroundUrl from '../../../public/assets/launcher-background.webp?url';
import './account-page.css';

export interface AccountCaptchaProps {
  onVerify(token: string): void;
  onExpire(): void;
  onError(): void;
}

/** The provider owns widget loading and cleanup; tokens stay in memory. */
export function AccountPage({captcha: Captcha, artworkSrc = backgroundUrl}: {captcha?: ComponentType<AccountCaptchaProps>; artworkSrc?: string}) {
  const [search, setSearch] = useSearchParams();
  const registering = search.get('mode') === 'register';
  const [username, setUsername] = useState(''), [email, setEmail] = useState('');
  const [identity, setIdentity] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false), [code, setCode] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const verifyCaptcha = useCallback((token: string) => setCaptchaToken(token), []);
  const clearCaptcha = useCallback(() => setCaptchaToken(''), []);
  const [codeEmail, setCodeEmail] = useState(''), [remaining, setRemaining] = useState(0);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const messageRef = useRef<HTMLParagraphElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = document.querySelector('.book-masthead');
    if (!header) return;
    const measure = () => {
      const style = getComputedStyle(header);
      const overlap = Math.max(parseFloat(style.borderBottomLeftRadius) || 0, parseFloat(style.borderBottomRightRadius) || 0);
      pageRef.current?.style.setProperty('--account-header-height', `${header.getBoundingClientRect().height}px`);
      pageRef.current?.style.setProperty('--account-header-overlap', `${overlap}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header); measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!remaining) return;
    const timer = window.setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);
  useEffect(() => {
    setPassword(''); setConfirmation(''); setCode(''); setCaptchaToken(''); setShowPassword(false); setMessage(''); setError('');
  }, [registering]);
  useEffect(() => {setCaptchaToken('');}, [email]);
  useEffect(() => {if (error) messageRef.current?.focus();}, [error]);
  const sendCode = () => {
    setError(''); setMessage('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {setError('请先填写有效的邮箱地址'); return;}
    setCodeEmail(email.trim()); setRemaining(60); setMessage('演示验证码：123456（不会发送邮件）');
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setMessage('');
    if (!registering) {
      if (!identity.trim()) {setError('请输入用户名或邮箱'); return;}
      if (!password) {setError('请输入密码'); return;}
      setMessage('登录演示完成，账号服务尚未接入。'); return;
    }
    if (!username.trim()) {setError('请输入用户名'); return;}
    if (password.length < 8) {setError('密码至少需要 8 位'); return;}
    if (password !== confirmation) {setError('两次输入的密码不一致'); return;}
    if (codeEmail !== email.trim() || code !== '123456') {setError('请获取并填写当前邮箱的演示验证码'); return;}
    if (Captcha && !captchaToken) {setError('请完成人机验证'); return;}
    setMessage('注册演示完成，账号信息不会保存。');
  };
  return <main ref={pageRef} className="account-page" aria-labelledby="account-title">
    <section className={`account-shell${registering ? ' is-registering' : ''}`}>
      <aside className="account-art" aria-hidden="true"><img src={artworkSrc} alt="" className="account-art-image"/></aside>
      <div className="account-content">
        <div className="account-topline"><AppLink href="./">← 返回游戏库</AppLink></div>
        <nav className="account-tabs" aria-label="账号操作">{[['login', '登录'], ['register', '注册']].map(([mode, label]) => <button type="button" key={mode} aria-current={registering === (mode === 'register') ? 'page' : undefined} onClick={() => setSearch(mode === 'register' ? {mode} : {})}>{label}</button>)}</nav>
        <header><h1 id="account-title">{registering ? '注册账号' : '登录'}</h1></header>
        <form method="post" onSubmit={submit}>
          {registering ? <>
            <label>用户名<input name="username" autoComplete="username" maxLength={32} required value={username} onChange={event => setUsername(event.target.value)} placeholder="填写用户名"/></label>
            <label>邮箱<input name="email" type="email" autoComplete="email" required value={email} onChange={event => {setEmail(event.target.value); setCaptchaToken('');}} placeholder="name@example.com"/></label>
            <label>邮箱验证码<span className="account-code"><input name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} placeholder="6 位验证码"/><button type="button" disabled={remaining > 0} onClick={sendCode}>{remaining ? `${remaining}s` : '获取验证码'}</button></span></label>
          </> : <label>用户名 / 邮箱<input name="identity" autoComplete="username" required value={identity} onChange={event => setIdentity(event.target.value)} placeholder="填写用户名或邮箱"/></label>}
          <label>密码<span className="account-password"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} minLength={registering ? 8 : undefined} required value={password} onChange={event => setPassword(event.target.value)} placeholder={registering ? '至少 8 位' : '填写密码'}/><button type="button" className="account-password-toggle" aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{showPassword && <path d="m3 3 18 18"/>}</svg></button></span></label>
          {registering && <><label>确认密码<input name="confirmation" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="再次填写密码" aria-invalid={confirmation.length > 0 && password !== confirmation ? true : undefined}/>{confirmation.length > 0 && password !== confirmation && <small className="account-field-error">两次输入的密码不一致</small>}</label>
            <div className="account-captcha-field"><span>人机验证</span><div className="account-captcha-slot" data-captcha-slot="" aria-label="人机验证服务预留区域">{Captcha && <Captcha key={email} onVerify={verifyCaptcha} onExpire={clearCaptcha} onError={clearCaptcha}/>}</div></div>
          </>}
          {error && <p className="account-feedback is-error" role="alert" ref={messageRef} tabIndex={-1}>{error}</p>}
          {message && <p className="account-feedback" role="status">{message}</p>}
          <button type="submit" className="account-submit">{registering ? '注册' : '登录'}<span aria-hidden="true">→</span></button>
        </form>
        {!registering && <><div className="account-divider"><span>或</span></div><button type="button" className="account-discord" onClick={() => {setError(''); setMessage('Discord 登录将在接入账号服务后开放。');}}><DiscordIcon/>使用 Discord 登录</button></>}
        <p className="account-demo-note">前端预览 · 尚未接入账号服务</p>
      </div>
    </section>
  </main>;
}

function DiscordIcon() {return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.7 5.2A18 18 0 0 0 15.5 4l-.5 1a15 15 0 0 0-6 0l-.5-1a18 18 0 0 0-4.2 1.2C1.7 9 1 12.6 1.4 16.2a17 17 0 0 0 5.2 2.6l1-1.6-1.6-.8.4-.3a13 13 0 0 0 11.2 0l.4.3-1.6.8 1 1.6a17 17 0 0 0 5.2-2.6c.5-4.2-.8-7.8-2.9-11ZM8.3 14.6c-1 0-1.7-.9-1.7-2s.7-2 1.7-2 1.8.9 1.7 2c0 1.1-.7 2-1.7 2Zm7.4 0c-1 0-1.7-.9-1.7-2s.7-2 1.7-2 1.8.9 1.7 2c0 1.1-.7 2-1.7 2Z"/></svg>;}
