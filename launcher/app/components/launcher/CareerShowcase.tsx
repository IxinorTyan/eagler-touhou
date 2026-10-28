import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {useLocale} from '../../i18n';
import {bookGameArtwork} from './book-artwork';
import {CAREER_GAMES, CAREER_STATUSES, CAREER_RESTRICTIONS, careerCellKey, careerCellAvailable, careerCount, careerDifficulties, careerBest,
  careerRecord, careerStatus, careerPreset, careerWithCounts, careerDescription, type CareerRecords, type CareerGame, type CareerRecord, type CareerStatus} from './career-records';
import './career-showcase.css';

export function CareerSummary({records, onOpen}: {records: CareerRecords; onOpen: (gameId?: string) => void}) {
  const games = CAREER_GAMES.filter(game => careerCount(game, records) > 0);
  return <section className="profile-panel career-overview">
    <div className="profile-section-title"><h2>生涯展示柜</h2><button type="button" onClick={() => onOpen()}>查看完整生涯 →</button></div>
    {games.length ? <div className="career-summary-list">{games.slice(0, 4).map(game => <button type="button" key={game.id} onClick={() => onOpen(game.id)}>
      <span className="career-summary-name"><small>TH{game.number}</small><strong>{game.title}</strong></span>
      <span className="career-badges">{careerDifficulties(game, records).map(difficulty => <span key={difficulty}>{difficulty} · {careerBest(game, difficulty, records)}</span>)}</span>
    </button>)}</div> : <div className="profile-empty"><span className="career-empty-mark" aria-hidden="true">▦</span><h3>尚未记录通关</h3><p>从一次不续关通关开始，留下你的东方生涯。</p><button type="button" onClick={() => onOpen()}>记录第一项 1CC →</button></div>}
  </section>;
}

export function CareerShowcase({records, initialGame, onSave}: {records: CareerRecords; initialGame?: string; onSave: (next: CareerRecords) => void}) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState<CareerRecords>({});
  const [expanded, setExpanded] = useState(initialGame ?? CAREER_GAMES[0].id);
  const [selection, setSelection] = useState<{key: string; label: string} | null>(null);
  const [brush, setBrush] = useState<CareerStatus | 'erase' | 'details'>('details');
  const [clearing, setClearing] = useState(false);
  const shown = editing ? draft : records;
  const edit = () => {setDraft({...records}); setEditing(true); setClearing(false); setBrush('details');};
  const cancel = () => {setEditing(false); setClearing(false); setSelection(null);};
  const update = (key: string, record: CareerRecord | undefined) => setDraft(current => {
    const next = {...current}; if (record) next[key] = record; else delete next[key];
    return next;
  });
  const count = CAREER_GAMES.reduce((sum, game) => sum + careerCount(game, shown), 0);
  const continued = Object.values(shown).filter(value => careerRecord(value)?.status === 'clear').length;
  return <section className="profile-panel career-showcase" aria-label="生涯展示柜">
    <div className="profile-section-title career-heading"><div><small className="career-eyebrow">1CC COLLECTION</small><h2>生涯展示柜</h2></div>
      {editing ? <div className="profile-actions"><button type="button" onClick={cancel}>取消</button><button type="button" className="profile-primary" onClick={() => {onSave(draft); cancel();}}>保存记录</button></div>
        : <button type="button" onClick={edit}>编辑生涯</button>}
    </div>
    <p className="career-intro">按作品、难度与机体，记录每一次突破：1CC、NM、NB、NN 与特殊限制。</p>
    <div className="career-toolbar"><span>已记录 <b>{count}</b> 项 1CC{continued > 0 && <> · <b>{continued}</b> 项续关通关</>}</span><details className="career-help"><summary>图例与规则 ⓘ</summary><div>
      <p><b>1CC</b>：从头开始，不使用续关，完成该难度全流程。</p>
      <p>NM：无 Miss；NB：无 Bomb；NN：同一次 1CC 同时无 Miss、无 Bomb。其他作品机制与限制请用 ★ 和备注说明。</p>
      <p><b>·</b> 尚无记录　<b>—</b> 不适用。每格展示一次代表记录；各难度独立，特殊限制独立标注。</p>
      <p>Miss / Bomb 留空表示未知；旧版勾选保留为普通 1CC。记录由你手动填写，保存在此浏览器。</p>
    </div></details></div>
    <div className="career-legend" aria-label="通关状态图例">{CAREER_STATUSES.map(status => <span key={status.id} data-status={status.id} title={status.detail}><b>{status.label}</b><small>{status.detail.split(' · ').at(-1)}</small></span>)}</div>
    {editing && <><div className="career-edit-bar"><span>选择状态，再点击格子快速填入；单格详情可补充次数与限制。</span>
      {clearing ? <span className="career-clear-confirm">清空所有记录？<button type="button" onClick={() => {setDraft({}); setClearing(false); setSelection(null);}}>清空</button><button type="button" onClick={() => setClearing(false)}>保留</button></span>
        : <button type="button" disabled={!Object.keys(shown).length} onClick={() => setClearing(true)}>清空记录</button>}
    </div>
    <div className="career-brushes" role="group" aria-label="填表工具">
      <button type="button" aria-pressed={brush === 'details'} onClick={() => setBrush('details')}>单格详情</button>
      {CAREER_STATUSES.map(status => <button type="button" key={status.id} data-status={status.id} title={status.detail} aria-pressed={brush === status.id} onClick={() => {setBrush(status.id); setSelection(null);}}>{status.label}</button>)}
      <button type="button" aria-pressed={brush === 'erase'} onClick={() => {setBrush('erase'); setSelection(null);}}>擦除</button>
    </div><p className="career-brush-hint">{brush === 'details' ? '点击格子打开详情，编辑后应用到草稿。' : `当前工具：${brush === 'erase' ? '擦除' : careerStatus(brush).label}。点击将替换该格的整项记录，最后保存生涯。`}</p></>}
    {selection && (!editing || brush === 'details') && <CareerCellDetail key={`${selection.key}:${JSON.stringify(shown[selection.key])}`} label={selection.label}
      record={careerRecord(shown[selection.key])} editing={editing} onApply={record => update(selection.key, record)} onClose={() => setSelection(null)}/>}
    <div className="career-games">{CAREER_GAMES.map(game => <CareerGameTable key={game.id} game={game} records={shown} editing={editing} expanded={expanded === game.id}
      onExpand={() => {setExpanded(expanded === game.id ? '' : game.id); setSelection(null);}}
      onCell={(key, label) => {setSelection({key, label}); if (editing && brush !== 'details') update(key, brush === 'erase' ? undefined : careerPreset(brush));}}/>)}</div>
    <p className="career-selection" role="status">{selection ? `${selection.label} · ${careerDescription(shown[selection.key])}` : (editing ? '选择工具，点击对应格子记录通关。' : '点击作品展开，点击格子查看完整说明。')}</p>
  </section>;
}

function CareerCellDetail({label, record, editing, onApply, onClose}: {
  label: string; record?: CareerRecord; editing: boolean; onApply: (record: CareerRecord | undefined) => void; onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [status, setStatus] = useState<CareerStatus>(record?.status ?? '1cc');
  const [misses, setMisses] = useState(record?.misses?.toString() ?? '');
  const [bombs, setBombs] = useState(record?.bombs?.toString() ?? '');
  useEffect(() => {heading.current?.focus({preventScroll: true});}, []);
  const preview = careerWithCounts({status}, misses === '' ? undefined : Number(misses), bombs === '' ? undefined : Number(bombs));
  return <section className="career-detail" aria-label="单格记录详情">
    <div className="career-detail-heading"><h3 ref={heading} tabIndex={-1}>{label}</h3><button type="button" aria-label="关闭单格详情" onClick={onClose}>×</button></div>
    {editing ? <form onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      onApply({...preview, restrictions: CAREER_RESTRICTIONS.filter(item => data.has(item.id)).map(item => item.id), challenge: String(data.get('challenge') ?? '').trim(), note: String(data.get('note') ?? '').trim()});
    }}>
      <div className="career-detail-fields"><label>通关方式<select aria-label="通关方式" value={status === 'clear' ? 'clear' : '1cc'} onChange={event => setStatus(event.target.value as CareerStatus)}><option value="1cc">不续关 · 1CC</option><option value="clear">续关通关</option></select></label>
        <label>Miss 次数<input aria-label="Miss 次数" type="number" min="0" max="9999" step="1" placeholder="未知" value={misses} onChange={event => setMisses(event.target.value)}/></label>
        <label>Bomb 次数<input aria-label="Bomb 次数" type="number" min="0" max="9999" step="1" placeholder="未知" value={bombs} onChange={event => setBombs(event.target.value)}/></label></div>
      <fieldset><legend>特殊限制</legend>{CAREER_RESTRICTIONS.map(item => <label key={item.id}><input type="checkbox" name={item.id} defaultChecked={record?.restrictions?.includes(item.id)}/><span>{item.label} · {item.detail.split(' · ').at(-1)}</span></label>)}</fieldset>
      <label className="career-note-label">自定义标记<input name="challenge" aria-label="自定义标记" maxLength={24} defaultValue={record?.challenge ?? ''} placeholder="例如 NNN、无结界；直接显示在格子里"/></label>
      <label className="career-note-label">备注 / 作品机制<textarea name="note" aria-label="备注 / 作品机制" maxLength={240} rows={2} defaultValue={record?.note ?? ''} placeholder="说明本次通关的规则与成绩"/></label>
      <div className="career-detail-footer"><span>显示为 <b>{careerStatus(preview.status).label}</b> · 次数留空表示未知</span><div className="profile-actions"><button type="button" disabled={!record} onClick={() => onApply(undefined)}>移除此格</button><button type="submit" className="profile-primary">应用到草稿</button></div></div>
      <p className="career-detail-hint">填写同一次通关的数据；应用后点击「保存记录」保存整张表。</p>
    </form> : <p className="career-detail-description">{careerDescription(record)}</p>}
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
      <span className="career-game-count">{completed ? <><b>{completed}</b> 项 1CC</> : '暂无 1CC'}</span><span className="career-expand" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg></span>
    </button>
    <div id={`career-table-${game.id}`} className="career-game-reveal" aria-hidden={!expanded} inert={!expanded}>
      <div className="career-game-body">
      {game.note && <p className="career-game-note">{game.note}</p>}
      <div className="career-table-scroll" tabIndex={0} role="region" aria-label={`${game.title} 通关表，可横向滚动`}>
        <table className="career-table" style={{'--career-column-count': game.loadouts.length} as CSSProperties}><caption className="visually-hidden">{game.title} 机体与难度通关记录</caption>
          <colgroup><col/>{game.loadouts.map(loadout => <col key={loadout.id}/>)}</colgroup>
          <thead><tr><th scope="col">难度 / 机体</th>{game.loadouts.map(loadout => <th scope="col" key={loadout.id}>{label(loadout)}</th>)}</tr></thead>
          <tbody>{game.difficulties.map(difficulty => <tr key={difficulty} data-difficulty={difficulty.toLowerCase()}><th scope="row"><span className="career-difficulty-dot" aria-hidden="true"/>{difficulty}</th>{game.loadouts.map(loadout => {
            const key = careerCellKey(game, difficulty, loadout.id), record = careerRecord(records[key]);
            const available = careerCellAvailable(game, difficulty);
            const cellLabel = `${game.title} · ${difficulty} · ${label(loadout)}`;
            const description = `${cellLabel} · ${available ? careerDescription(records[key]) : '不适用'}`;
            return <td key={loadout.id}>{available ? <button type="button" className={`career-cell${record ? ' is-complete' : ''}`} aria-pressed={!!record} data-status={record?.status}
              aria-label={description} title={description} onClick={() => onCell(key, cellLabel)}>
              <span aria-hidden="true">{record ? careerStatus(record.status).label : '·'}</span>
              {record && <small aria-hidden="true">{[record.misses ? `${record.misses}M` : '', record.bombs ? `${record.bombs}B` : '',
                ...(record.restrictions ?? []).map(id => CAREER_RESTRICTIONS.find(item => item.id === id)!.label),
                record.challenge, record.note && !record.challenge && !(record.restrictions ?? []).includes('special') ? '★' : ''].filter(Boolean).join(' · ')}</small>}
            </button> : <span className="career-unavailable" title={game.note} aria-label={description}>—</span>}</td>;
          })}</tr>)}</tbody>
        </table>
      </div>
      <p className="career-scroll-hint">横向滑动查看机体 · {editing ? '点击格子编辑' : '点击格子查看详情'}</p>
      </div>
    </div>
  </article>;
}

