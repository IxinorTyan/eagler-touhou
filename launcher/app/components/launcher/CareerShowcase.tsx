import {useState} from 'react';
import {useLocale} from '../../i18n';
import {bookGameArtwork} from './book-artwork';
import {CAREER_GAMES, careerCellKey, careerCellAvailable, careerCount, careerDifficulties, type CareerRecords, type CareerGame} from './career-records';
import './career-showcase.css';

export function CareerSummary({records, onOpen}: {records: CareerRecords; onOpen: (gameId?: string) => void}) {
  const games = CAREER_GAMES.filter(game => careerCount(game, records) > 0);
  return <section className="profile-panel career-overview">
    <div className="profile-section-title"><h2>生涯展示柜</h2><button type="button" onClick={() => onOpen()}>查看完整生涯 →</button></div>
    {games.length ? <div className="career-summary-list">{games.slice(0, 4).map(game => <button type="button" key={game.id} onClick={() => onOpen(game.id)}>
      <span className="career-summary-name"><small>TH{game.number}</small><strong>{game.title}</strong></span>
      <span className="career-badges">{careerDifficulties(game, records).map(difficulty => <span key={difficulty}>✓ {difficulty}</span>)}</span>
    </button>)}</div> : <div className="profile-empty"><span className="career-empty-mark" aria-hidden="true">▦</span><h3>尚未记录通关</h3><p>从一次不续关通关开始，留下你的东方生涯。</p><button type="button" onClick={() => onOpen()}>记录第一项 1CC →</button></div>}
  </section>;
}

export function CareerShowcase({records, initialGame, onSave}: {records: CareerRecords; initialGame?: string; onSave: (next: CareerRecords) => void}) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState<CareerRecords>({});
  const [expanded, setExpanded] = useState(initialGame ?? CAREER_GAMES[0].id);
  const [selection, setSelection] = useState('');
  const [clearing, setClearing] = useState(false);
  const shown = editing ? draft : records;
  const edit = () => {setDraft({...records}); setEditing(true); setClearing(false);};
  const cancel = () => {setEditing(false); setClearing(false); setSelection('');};
  const toggle = (key: string) => setDraft(current => {
    const next = {...current}; if (next[key]) delete next[key]; else next[key] = true;
    return next;
  });
  const count = CAREER_GAMES.reduce((sum, game) => sum + careerCount(game, shown), 0);
  return <section className="profile-panel career-showcase" aria-label="生涯展示柜">
    <div className="profile-section-title career-heading"><div><small className="career-eyebrow">1CC COLLECTION</small><h2>生涯展示柜</h2></div>
      {editing ? <div className="profile-actions"><button type="button" onClick={cancel}>取消</button><button type="button" className="profile-primary" onClick={() => {onSave(draft); cancel();}}>保存记录</button></div>
        : <button type="button" onClick={edit}>编辑生涯</button>}
    </div>
    <p className="career-intro">各作品、难度与机体的不续关通关记录。</p>
    <div className="career-toolbar"><span>已记录 <b>{count}</b> 项 1CC</span><details className="career-help"><summary>图例与规则 ⓘ</summary><div>
      <p><b>1CC</b>：从头开始，不使用续关，完成该难度全流程。</p>
      <p><b>✓</b> 已记录通关　<b>·</b> 尚无记录　<b>—</b> 不适用</p>
      <p>空格表示尚无记录，不代表未曾通关。各难度独立记录，完成高难度不会自动填充其他难度。</p>
    </div></details></div>
    {editing && <div className="career-edit-bar"><span>点击格子添加或移除通关。手动记录 · 保存在此浏览器</span>
      {clearing ? <span className="career-clear-confirm">清空所有记录？<button type="button" onClick={() => {setDraft({}); setClearing(false); setSelection('');}}>清空</button><button type="button" onClick={() => setClearing(false)}>保留</button></span>
        : <button type="button" disabled={!count} onClick={() => setClearing(true)}>清空记录</button>}
    </div>}
    <div className="career-games">{CAREER_GAMES.map(game => <CareerGameTable key={game.id} game={game} records={shown} editing={editing} expanded={expanded === game.id}
      onExpand={() => {setExpanded(expanded === game.id ? '' : game.id); setSelection('');}}
      onCell={(key, description) => {setSelection(description); if (editing) toggle(key);}}/>)}</div>
    <p className="career-selection" role="status">{selection || (editing ? '选择作品，点击对应格子记录通关。' : '点击作品展开，点击格子查看完整说明。')}</p>
  </section>;
}

function CareerGameTable({game, records, editing, expanded, onExpand, onCell}: {
  game: CareerGame; records: CareerRecords; editing: boolean; expanded: boolean; onExpand: () => void; onCell: (key: string, description: string) => void;
}) {
  const {t} = useLocale();
  const label = (loadout: CareerGame['loadouts'][number]) => loadout.label ?? t(loadout.labelKey);
  const completed = careerCount(game, records);
  return <article className={`career-game${expanded ? ' is-expanded' : ''}`} data-career-game={game.id}>
    <button type="button" className="career-game-toggle" aria-expanded={expanded} aria-controls={`career-table-${game.id}`} onClick={onExpand}>
      <span className="career-game-art">{bookGameArtwork(game.id) && <img src={bookGameArtwork(game.id)} alt=""/>}</span>
      <span className="career-game-name"><small>TH{game.number}</small><strong>{game.title}</strong></span>
      <span className="career-game-count">{completed ? <><b>{completed}</b> 项通关</> : '尚无记录'}</span><span className="career-expand" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg></span>
    </button>
    <div id={`career-table-${game.id}`} className="career-game-reveal" aria-hidden={!expanded} inert={!expanded}>
      <div className="career-game-body">
      {game.note && <p className="career-game-note">{game.note}</p>}
      <div className="career-table-scroll" tabIndex={0} role="region" aria-label={`${game.title} 通关表，可横向滚动`}>
        <table className="career-table"><caption className="visually-hidden">{game.title} 机体与难度通关记录</caption>
          <thead><tr><th scope="col">难度 / 机体</th>{game.loadouts.map(loadout => <th scope="col" key={loadout.id}>{label(loadout)}</th>)}</tr></thead>
          <tbody>{game.difficulties.map(difficulty => <tr key={difficulty} data-difficulty={difficulty.toLowerCase()}><th scope="row"><span className="career-difficulty-dot" aria-hidden="true"/>{difficulty}</th>{game.loadouts.map(loadout => {
            const key = careerCellKey(game, difficulty, loadout.id), checked = !!records[key];
            const available = careerCellAvailable(game, difficulty);
            const description = `${game.title} · ${difficulty} · ${label(loadout)} · ${checked ? '已记录通关' : '尚无记录'}`;
            return <td key={loadout.id}>{available ? <button type="button" className={`career-cell${checked ? ' is-complete' : ''}`} aria-pressed={checked}
              aria-label={description} title={description} onClick={() => onCell(key, editing ? `${game.title} · ${difficulty} · ${label(loadout)} · ${checked ? '已移除记录' : '已标记通关'}` : description)}>
              <span aria-hidden="true">{checked ? '✓' : '·'}</span>
            </button> : <span className="career-unavailable" title={game.note} aria-label={description}>—</span>}</td>;
          })}</tr>)}</tbody>
        </table>
      </div>
      <p className="career-scroll-hint">横向滑动查看机体 · {editing ? '点击格子编辑' : '点击格子查看详情'}</p>
      </div>
    </div>
  </article>;
}

