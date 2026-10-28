import {useEffect, useState, type CSSProperties} from 'react';
import {AppLink} from './AppLink';
import {useLocale} from '../../i18n';
import {PRODUCT_GAMES, gameIdForProduct, isProductId} from '../../../src/contracts/product-catalog.mts';
import {bookGameArtwork} from './book-artwork';
import {BOOK_PREFERENCES_EVENT, readBookPreference, writeBookPreference, stringArray} from './book-preferences';
import './profile-preview.css';
import {CareerSummary, CareerShowcase} from './CareerShowcase';
import {CAREER_STORAGE_KEY, loadCareerRecords, type CareerRecords} from './tracker-records';
import {NavigationIcon} from './NavigationIcon';

type SocialLink = {label: string; url: string};
type Profile = {name: string; bio: string; avatar: string; cover: string; links: SocialLink[]};
type Guide = {id: string; title: string; body: string};
type DisplayKey = 'friends' | 'career' | 'records' | 'content' | 'recent';
type OverviewKey = 'career' | 'recent' | 'favorites';
type ProfileDisplay = {visible: Record<DisplayKey, boolean>; order: OverviewKey[]};
const displayLabels: Record<DisplayKey, string> = {friends: '好友', career: '生涯', records: '游玩记录', content: '内容', recent: '最近启动'};
const overviewLabels: Record<OverviewKey, string> = {career: '通关图', recent: '最近启动', favorites: '收藏的游戏'};
const defaultDisplay: ProfileDisplay = {visible: {friends: true, career: true, records: true, content: true, recent: true}, order: ['career', 'recent', 'favorites']};
const displayStorageKey = 'player-profile-display-v1';
const validDisplay = (value: unknown): value is ProfileDisplay => {
  if (!value || typeof value !== 'object') return false;
  const settings = value as ProfileDisplay;
  return !!settings.visible && Object.keys(displayLabels).every(key => typeof settings.visible[key as DisplayKey] === 'boolean') &&
    Array.isArray(settings.order) && settings.order.length === 3 && new Set(settings.order).size === 3 && settings.order.every(key => Object.hasOwn(overviewLabels, key));
};
const blankProfile: Profile = {name: '', bio: '', avatar: '', cover: '', links: []};
const imageData = (value: string) => /^data:image\/(png|jpeg|webp);base64,/i.test(value);
const safeUrl = (value: string) => {try {const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url : null;} catch {return null;}};
const validProfile = (value: unknown): value is Profile => {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Profile;
  return ['name', 'bio', 'avatar', 'cover'].every(key => typeof (profile as unknown as Record<string, unknown>)[key] === 'string') &&
    Array.isArray(profile.links) && profile.links.every(link => link && typeof link.label === 'string' && typeof link.url === 'string' && !!safeUrl(link.url));
};
const validGuides = (value: unknown): value is Guide[] => Array.isArray(value) && value.every(item => item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.body === 'string');

/** Browser-local presentation only. No account or room identity is created. */
export function ProfilePreview({interactive = true, active, href}: {interactive?: boolean; active: boolean; href: string}) {
  const {locale} = useLocale();
  const [avatar, setAvatar] = useState('');
  useEffect(() => {
    const refresh = () => setAvatar(readBookPreference('player-profile-v2', blankProfile, validProfile).avatar);
    refresh(); window.addEventListener(BOOK_PREFERENCES_EVENT, refresh); window.addEventListener('storage', refresh);
    return () => {window.removeEventListener(BOOK_PREFERENCES_EVENT, refresh); window.removeEventListener('storage', refresh);};
  }, []);
  const content = <span aria-hidden="true">{imageData(avatar) ? <img src={avatar} alt=""/> : <NavigationIcon name="profile"/>}</span>;
  return interactive ? <AppLink className="book-profile-trigger" href={href} aria-label={locale === 'en' ? 'Player profile' : '玩家主页'} aria-current={active ? 'page' : undefined}>{content}</AppLink>
    : <a className="book-profile-trigger" href={href} aria-label={locale === 'en' ? 'Player profile' : '玩家主页'} aria-current={active ? 'page' : undefined}>{content}</a>;
}

export function ProfilePage() {
  const [profile, setProfile] = useState(blankProfile), [draft, setDraft] = useState(blankProfile);
  const [tab, setTab] = useState('概览'), [editing, setEditing] = useState(false);
  const [display, setDisplay] = useState(defaultDisplay), [displayDraft, setDisplayDraft] = useState(defaultDisplay);
  const [displayEditing, setDisplayEditing] = useState(false);
  const [settings, setSettings] = useState(false), [security, setSecurity] = useState(false);
  const [visitor, setVisitor] = useState(false);
  const [recent, setRecent] = useState<string[]>([]), [favorites, setFavorites] = useState<string[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]), [guideDraft, setGuideDraft] = useState<Guide | null>(null);
  const [career, setCareer] = useState<CareerRecords>({});
  const [article, setArticle] = useState<Guide | null>(null), [socialTab, setSocialTab] = useState('好友');
  const [demoOnline, setDemoOnline] = useState(false), [onlineNotice, setOnlineNotice] = useState(false);
  const [notifications, setNotifications] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  useEffect(() => {if (settings) window.scrollTo(0, 0);}, [settings, editing, displayEditing, security]);
  useEffect(() => {
    setProfile(readBookPreference('player-profile-v2', blankProfile, validProfile));
    setDisplay(readBookPreference(displayStorageKey, defaultDisplay, validDisplay));
    setGuides(readBookPreference('player-guide-drafts-v1', [], validGuides));
    setCareer(loadCareerRecords());
    setNotifications(readBookPreference('friend-online-reminder', false, (value): value is boolean => typeof value === 'boolean'));
    const refresh = () => {setRecent(readBookPreference('recent', [], stringArray)); setFavorites(readBookPreference('favorites', [], stringArray));};
    refresh(); window.addEventListener(BOOK_PREFERENCES_EVENT, refresh); window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(BOOK_PREFERENCES_EVENT, refresh); window.removeEventListener('storage', refresh);};
  }, []);
  useEffect(() => {if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3500); return () => window.clearTimeout(timer);}, [notice]);
  const back = () => {setSettings(false); setSecurity(false); if (displayEditing) setDisplayEditing(false); else if (editing) setEditing(false); else if (guideDraft) setGuideDraft(null); else if (article) setArticle(null); setError('');};
  const editProfile = () => {setSettings(true); setSecurity(false); setDraft({...profile, links: profile.links.map(link => ({...link}))}); setDisplayEditing(false); setEditing(true); setError('');};
  const uploadImage = (file: File | undefined, field: 'avatar' | 'cover') => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 750_000) {setError('请选择小于 750 KB 的 PNG、JPEG 或 WebP 图片'); return;}
    const reader = new FileReader();
    reader.onload = () => {if (typeof reader.result === 'string') {const value = reader.result; setDraft(current => ({...current, [field]: value})); setError('');}};
    reader.onerror = () => setError('图片读取失败，请重试'); reader.readAsDataURL(file);
  };
  const saveProfile = () => {
    if (draft.links.some(link => !link.label.trim() || !safeUrl(link.url))) {setError('请填写链接名称和有效的 HTTP / HTTPS 地址，或删除空链接'); return;}
    const next = {...draft, name: draft.name.trim(), links: draft.links.map(link => ({label: link.label.trim(), url: safeUrl(link.url)!.href}))};
    setProfile(next); writeBookPreference('player-profile-v2', next); setError(''); setNotice('资料已保存到此浏览器');
  };
  const saveGuide = () => {
    if (!guideDraft?.title.trim() || !guideDraft.body.trim()) {setError('请填写标题和正文'); return;}
    const next = guides.some(guide => guide.id === guideDraft.id) ? guides.map(guide => guide.id === guideDraft.id ? guideDraft : guide) : [...guides, guideDraft];
    setGuides(next); writeBookPreference('player-guide-drafts-v1', next); setGuideDraft(null); setArticle(null); setError(''); setNotice('草稿已保存到此浏览器');
  };
  const startGuide = () => {setGuideDraft({id: crypto.randomUUID(), title: '', body: ''}); setError('');};
  const saveCareer = (next: CareerRecords) => {setCareer(next); writeBookPreference(CAREER_STORAGE_KEY, next); setNotice('生涯记录已保存到此浏览器');};
  const editDisplay = () => {setSettings(true); setSecurity(false); setDisplayDraft({visible: {...display.visible}, order: [...display.order]}); setDisplayEditing(true); setEditing(false); setArticle(null); setGuideDraft(null); setError('');};
  const saveDisplay = () => {
    setDisplay(displayDraft); writeBookPreference(displayStorageKey, displayDraft); setNotice('隐私与个性化已保存');
    const tabKey = ({'生涯': 'career', '游玩记录': 'records', '内容': 'content', '好友': 'friends'} as Record<string, DisplayKey>)[tab];
    if (visitor && tabKey && !displayDraft.visible[tabKey]) setTab('概览');
  };
  const moveOverview = (key: OverviewKey, offset: number) => setDisplayDraft(current => {
    const order = [...current.order], index = order.indexOf(key), target = index + offset;
    if (target < 0 || target >= order.length) return current;
    [order[index], order[target]] = [order[target], order[index]];
    return {...current, order};
  });
  const visible = visitor ? display.visible : defaultDisplay.visible;
  const visibleTabs = ['概览', ...(visible.career ? ['生涯'] : []), ...(visible.records ? ['游玩记录'] : []), ...(visible.content ? ['内容'] : []), ...(visible.friends ? ['好友'] : [])];
  return <main className={`player-profile${settings ? ' profile-editing profile-settings' : visitor ? ' profile-visitor' : ''}`} aria-label={settings ? '账户设置' : undefined} aria-labelledby={settings ? undefined : 'profile-name'}>
    {settings && <div className="profile-settings-backdrop" aria-hidden="true"><span/></div>}
    {(settings || article || guideDraft) && <div className="profile-topbar"><button type="button" onClick={back}>← 返回主页</button></div>}
    <div className="profile-wrap">
      {settings && <div className="profile-settings-heading"><h1>账户设置</h1><nav aria-label="账户设置分类"><button type="button" aria-current={editing ? 'page' : undefined} onClick={editProfile}>编辑资料</button><button type="button" aria-current={displayEditing ? 'page' : undefined} onClick={editDisplay}>隐私与个性化</button><button type="button" aria-current={security ? 'page' : undefined} onClick={() => {setEditing(false); setDisplayEditing(false); setSecurity(true); setError('');}}>账户与安全</button></nav></div>}
      <section className="profile-hero" style={imageData(profile.cover) ? {'--profile-cover': `url("${profile.cover}")`} as CSSProperties : undefined}>
        <div className={`profile-cover${imageData(profile.cover) ? ' has-image' : ''}`}/>
        <div className="profile-identity"><button type="button" className="profile-avatar" aria-label="修改头像" disabled={visitor} onClick={editProfile}>{imageData(profile.avatar) ? <img src={profile.avatar} alt="个人头像"/> : <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="17" r="8"/><path d="M9 42v-5a15 15 0 0 1 30 0v5"/></svg>}</button><div className="profile-name"><h1 id="profile-name">{profile.name || '未设置名字'}</h1><p>{profile.bio ? profile.bio.split('\n')[0] : '尚未填写简介'}</p></div><div className="profile-actions"><button type="button" className="profile-perspective" aria-label="切换个人主页视角" aria-pressed={visitor} onClick={() => {setVisitor(value => !value); setTab('概览'); setArticle(null); setGuideDraft(null);}}>视角：{visitor ? '访客' : '自己'}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/></svg></button><button type="button" onClick={editProfile}>账户设置</button></div></div>
      </section>
      <nav style={{'--profile-tab-count': visibleTabs.length} as CSSProperties} className="profile-tabs" aria-label="个人主页栏目">{visibleTabs.map(item => <button type="button" key={item} aria-current={tab === item && !editing && !displayEditing ? 'page' : undefined} onClick={() => {setTab(item); setDisplayEditing(false); setEditing(false); setArticle(null); setGuideDraft(null); setError('');}}>{item}</button>)}</nav>
      {settings && security ? <AccountSecurity/> : displayEditing ? <section className="profile-panel profile-editor-shell profile-display-editor"><div className="profile-section-title"><h2><ProfileSectionIcon name="layout"/>隐私与个性化</h2></div><form onSubmit={event => {event.preventDefault(); saveDisplay();}}>
        <div className="profile-display-columns"><fieldset><legend>向访客展示</legend><div className="profile-display-options">{(Object.keys(displayLabels) as DisplayKey[]).map(key => <label key={key}><span className="profile-option-name"><ProfileSectionIcon name={key}/><span>{displayLabels[key]}</span></span><input type="checkbox" role="switch" checked={displayDraft.visible[key]} onChange={event => setDisplayDraft({...displayDraft, visible: {...displayDraft.visible, [key]: event.target.checked}})}/></label>)}</div></fieldset>
        <fieldset><legend>概览顺序</legend><ol className="profile-display-order">{displayDraft.order.map((key, index) => <li key={key} data-overview-key={key} className={key !== 'favorites' && !displayDraft.visible[key] ? 'is-hidden' : undefined}><div className={`profile-order-art profile-order-art-${key}`} aria-hidden="true"><ProfileSectionIcon name={key}/><i/><i/><i/></div><span className="profile-order-label"><small>{String(index + 1).padStart(2, '0')}</small>{overviewLabels[key]}</span><div><button type="button" aria-label={`上移${overviewLabels[key]}`} disabled={index === 0} onClick={() => moveOverview(key, -1)}>↑</button><button type="button" aria-label={`下移${overviewLabels[key]}`} disabled={index === displayDraft.order.length - 1} onClick={() => moveOverview(key, 1)}>↓</button></div></li>)}</ol></fieldset></div>
        <div className="profile-actions profile-editor-footer"><button type="button" onClick={back}>取消</button><button type="submit" className="profile-primary">保存展示</button></div>
      </form></section> : editing ? <section className="profile-panel profile-editor profile-editor-shell profile-details-editor"><div className="profile-section-title"><h2><ProfileSectionIcon name="profile"/>编辑个人资料</h2></div><form onSubmit={event => {event.preventDefault(); saveProfile();}}>
        <div className="profile-details-columns"><div className="profile-media-editor"><div className="profile-draft-preview"><div className={`profile-draft-cover${imageData(draft.cover) ? ' has-image' : ''}`} style={imageData(draft.cover) ? {backgroundImage: `url("${draft.cover}")`} : undefined}/><div className="profile-draft-identity"><span className="profile-draft-avatar">{imageData(draft.avatar) ? <img src={draft.avatar} alt="头像预览"/> : <AvatarPlaceholder/>}</span><strong>{draft.name || '未设置名字'}</strong><p>{draft.bio.split('\n')[0] || '尚未填写简介'}</p></div></div>
        <div className="profile-image-fields">{(['avatar', 'cover'] as const).map(field => <fieldset key={field}><legend>{field === 'avatar' ? '头像' : '主页封面'}</legend><label className="profile-image-upload"><ProfileSectionIcon name="upload"/><span>选择图片</span><input type="file" aria-label={field === 'avatar' ? '选择头像图片' : '选择封面图片'} accept="image/png,image/jpeg,image/webp" onChange={event => uploadImage(event.target.files?.[0], field)}/></label>{draft[field] && <button type="button" className="profile-image-remove" onClick={() => setDraft({...draft, [field]: ''})}>移除</button>}</fieldset>)}</div><small className="profile-upload-hint">PNG / JPEG / WebP，最大 750 KB</small></div><div className="profile-detail-fields">
        <label>名字<input maxLength={32} value={draft.name} onChange={event => setDraft({...draft, name: event.target.value})} placeholder="填写名字"/></label>
        <label>简介<textarea rows={4} maxLength={500} value={draft.bio} onChange={event => setDraft({...draft, bio: event.target.value})} placeholder="介绍一下自己"/><small>{draft.bio.length} / 500</small></label>
        <fieldset><legend>社交媒体链接</legend>{draft.links.map((link, index) => <div className="profile-link-editor" key={index}><label>名称<input maxLength={40} value={link.label} onChange={event => setDraft({...draft, links: draft.links.map((item, i) => i === index ? {...item, label: event.target.value} : item)})}/></label><label>地址<input type="url" placeholder="https://" value={link.url} onChange={event => setDraft({...draft, links: draft.links.map((item, i) => i === index ? {...item, url: event.target.value} : item)})}/></label><button type="button" aria-label={`删除链接 ${index + 1}`} onClick={() => setDraft({...draft, links: draft.links.filter((_, i) => i !== index)})}>删除</button></div>)}<button type="button" onClick={() => setDraft({...draft, links: [...draft.links, {label: '', url: ''}]})}>＋ 添加链接</button></fieldset></div></div>
        {error && <p role="alert">{error}</p>}<div className="profile-actions profile-editor-footer"><button type="button" onClick={back}>取消</button><button className="profile-primary" type="submit">保存资料</button></div>
      </form></section> : <div className="profile-columns"><aside className="profile-aside"><section className="profile-panel"><div className="profile-section-title"><h2>个人简介</h2>{!visitor && <button type="button" onClick={editProfile}>编辑</button>}</div>{profile.bio ? <p className="profile-bio">{profile.bio}</p> : <p className="profile-muted">尚未填写简介</p>}{profile.links.length > 0 && <div className="profile-social-links">{profile.links.map((link, index) => <a key={index} href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>)}</div>}</section><section className="profile-panel"><div className="profile-section-title"><h2>账号信息</h2></div><dl className="profile-account-meta"><div><dt>注册时间</dt><dd>—</dd></div></dl><p className="profile-muted">尚未关联账号</p><AppLink className="profile-account-login" href="login.html">登录 / 注册 →</AppLink></section></aside>
        <div className="profile-content">{tab === '概览' && display.order.map(key => key === 'career' ? (visible.career && <CareerSummary key={key} records={career}/>) : key === 'recent' ? (visible.recent && <section key={key} className="profile-panel"><div className="profile-section-title"><h2>最近启动</h2>{visible.records && <button type="button" onClick={() => setTab('游玩记录')}>查看全部 →</button>}</div><LocalGames ids={recent.slice(0, 4)} empty="暂无启动记录"/></section>) : <section key={key} className="profile-panel"><div className="profile-section-title"><h2>收藏的游戏</h2><span>{favorites.filter(isProductId).length} 部</span></div><LocalGames ids={favorites} empty="还没有收藏的游戏"/></section>)}
        {visible.career && tab === '生涯' && <CareerShowcase records={career} onSave={saveCareer} readOnly={visitor}/>}
        {visible.records && tab === '游玩记录' && <><section className="profile-panel"><div className="profile-section-title"><h2>游玩统计</h2></div><EmptyState title="暂无游玩统计" detail="有记录后将在这里显示各作品的游玩时长与成绩。"/></section>{visible.recent && <section className="profile-panel"><div className="profile-section-title"><h2>最近启动</h2><span>此浏览器</span></div><LocalGames ids={recent} empty="暂无启动记录"/></section>}</>}
        {visible.content && tab === '内容' && (guideDraft ? <section className="profile-panel profile-editor"><h2>{guides.some(guide => guide.id === guideDraft.id) ? '编辑草稿' : '新建内容草稿'}</h2><form onSubmit={event => {event.preventDefault(); saveGuide();}}><label>标题<input value={guideDraft.title} maxLength={100} required onChange={event => setGuideDraft({...guideDraft, title: event.target.value})}/></label><label>正文<textarea rows={14} value={guideDraft.body} maxLength={30000} required onChange={event => setGuideDraft({...guideDraft, body: event.target.value})}/></label>{error && <p role="alert">{error}</p>}<div className="profile-actions"><button type="button" onClick={() => setGuideDraft(null)}>取消</button><button type="submit" className="profile-primary">保存到本地</button></div></form></section> : article ? <article className="profile-panel profile-article"><div className="profile-section-title"><button type="button" onClick={() => setArticle(null)}>← 草稿列表</button>{!visitor && <button type="button" onClick={() => setGuideDraft({...article})}>编辑</button>}</div><h2>{article.title}</h2><p className="profile-guide-body">{article.body}</p></article> : <section className="profile-panel"><div className="profile-section-title"><h2>我的内容</h2>{!visitor && <button type="button" onClick={startGuide}>＋ 新建草稿</button>}</div>{guides.length ? <div className="profile-draft-list">{guides.map(guide => <button key={guide.id} type="button" onClick={() => setArticle(guide)}><span><strong>{guide.title}</strong><small>{guide.body.slice(0, 100)}</small></span><span>本地草稿 →</span></button>)}</div> : <EmptyState title="还没有内容" detail="可以先写一份草稿，保存在此浏览器。"/>}</section>)}
        {visible.friends && tab === '好友' && <section className="profile-panel"><div className="profile-section-title"><h2>好友与关注</h2></div><div className="profile-social-tools"><div>{['好友', '关注'].map(item => <button type="button" key={item} aria-pressed={socialTab === item} onClick={() => setSocialTab(item)}>{item}</button>)}</div><label><input type="checkbox" checked={notifications} onChange={event => {setNotifications(event.target.checked); if (!event.target.checked) setOnlineNotice(false); writeBookPreference('friend-online-reminder', event.target.checked);}}/>好友上线提醒</label></div>{demoOnline && socialTab === '好友' ? <div className="profile-demo-friend"><span className="profile-demo-avatar"><AvatarPlaceholder/><i/></span><div><strong>演示好友</strong><p>在线 <small>· 模拟状态</small></p></div><button type="button" onClick={() => {setDemoOnline(false); setOnlineNotice(false);}}>结束模拟</button></div> : <EmptyState title={socialTab === '好友' ? '暂无好友数据' : '暂无关注数据'} detail="关联账号后显示。"/>}<div className="profile-reminder-demo"><span>提醒预览</span><button type="button" onClick={() => {setDemoOnline(true); setOnlineNotice(notifications); if (!notifications) setNotice('已模拟上线；开启好友上线提醒后可预览通知');}}>模拟好友上线</button></div></section>}
        </div></div>}
    </div>{notice && <div className="profile-toast" role="status">{notice}</div>}
  {onlineNotice && visible.friends && <aside className="profile-online-notice" role="status" aria-label="好友上线提醒"><span className="profile-demo-avatar"><AvatarPlaceholder/><i/></span><div className="profile-online-copy"><div><span>好友上线</span><small>刚刚 · 演示</small></div><strong>演示好友</strong><p>现在在线</p><button type="button" onClick={() => {setTab('好友'); setSocialTab('好友'); setDisplayEditing(false); setEditing(false); setOnlineNotice(false);}}>查看好友 →</button></div><button type="button" className="profile-notice-close" aria-label="关闭上线提醒" onClick={() => setOnlineNotice(false)}>×</button></aside>}</main>;
}

function AccountSecurity() {
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [sentTo, setSentTo] = useState('');
  const [current, setCurrent] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [feedback, setFeedback] = useState('');
  return <section className="profile-panel profile-editor-shell profile-security-editor">
    <div className="profile-section-title"><h2>账户与安全</h2><span>前端预览 · 尚未接入账号服务</span></div>
    <div className="profile-security-body">
      <section className="profile-security-section"><h3>关联账户</h3><div className="profile-binding-row"><div><strong>Discord</strong><p className="profile-muted">未绑定</p></div><button type="button" onClick={() => setFeedback('Discord 绑定将在接入账号服务后开放。')}>绑定 Discord</button></div></section>
      <section className="profile-security-section"><h3>修改邮箱</h3><form method="post" onSubmit={event => {event.preventDefault(); setFeedback(sentTo === email.trim() && code === '123456' ? '邮箱修改演示完成，邮箱不会保存。' : '请获取并填写当前邮箱的演示验证码');}}>
        <label>新邮箱<input type="email" name="new-email" autoComplete="email" required value={email} onChange={event => {setEmail(event.target.value); setCode(''); setSentTo('');}} placeholder="name@example.com"/></label>
        <label>邮箱验证码<div className="profile-security-code"><input name="email-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} placeholder="6 位验证码"/><button type="button" onClick={() => {if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {setFeedback('请先填写有效的邮箱地址'); return;} setSentTo(email.trim()); setFeedback('演示验证码：123456（不会发送邮件）');}}>获取验证码</button></div></label>
        <button className="profile-primary" type="submit">修改邮箱</button>
      </form></section>
      <section className="profile-security-section"><h3>修改密码</h3><form method="post" onSubmit={event => {event.preventDefault(); if (password !== confirmation) {setFeedback('两次输入的密码不一致'); return;} setCurrent(''); setPassword(''); setConfirmation(''); setFeedback('密码修改演示完成，密码不会保存。');}}>
        <label>当前密码<input name="current-password" type="password" autoComplete="current-password" required value={current} onChange={event => setCurrent(event.target.value)}/></label>
        <label>新密码<input name="new-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 8 位"/></label>
        <label>确认新密码<input name="confirm-new-password" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} aria-invalid={confirmation.length > 0 && password !== confirmation ? true : undefined}/></label>
        <button className="profile-primary" type="submit">修改密码</button>
      </form></section>
      {feedback && <p className="profile-security-feedback" role="status">{feedback}</p>}
    </div>
  </section>;
}

function EmptyState({title, detail}: {title: string; detail?: string}) {return <div className="profile-empty"><h3>{title}</h3>{detail && <p>{detail}</p>}</div>;}
function LocalGames({ids, empty}: {ids: string[]; empty: string}) {
  const products = ids.filter(isProductId);
  if (!products.length) return <EmptyState title={empty}/>;
  return <div className="profile-local-games">{products.map(id => {const gameId = gameIdForProduct(id), game = PRODUCT_GAMES[gameId]; return <div className="profile-local-game" key={id}>{bookGameArtwork(gameId) ? <img src={bookGameArtwork(gameId)} alt=""/> : <span className="profile-game-placeholder">TH{game.number}</span>}<div><small>TH{game.number}</small><strong>{game.title}</strong><p>{game.subtitle}</p></div></div>;})}</div>;
}

function AvatarPlaceholder() {return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="17" r="8"/><path d="M9 42v-5a15 15 0 0 1 30 0v5"/></svg>;}

function ProfileSectionIcon({name}: {name: string}) {
  const paths: Record<string, string> = {
    friends: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75',
    career: 'M4 20V10h4v10m4 0V4h4v16m4 0V8h2v12M2 20h21',
    records: 'M4 5h16v15H4zM8 2v6m8-6v6M8 12h8m-8 4h5',
    content: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7m-7 4h5',
    recent: 'M12 7v5l3 2M3 11a9 9 0 1 1 2 7M3 5v6h6',
    favorites: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
    layout: 'M3 3h18v18H3zM3 9h18M10 9v12',
    profile: 'M5 21v-2a7 7 0 0 1 14 0v2',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  };
  return <svg className="profile-section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.layout}/>{name === 'profile' && <circle cx="12" cy="7" r="4"/>}{name === 'friends' && <circle cx="9" cy="7" r="4"/>}</svg>;
}
