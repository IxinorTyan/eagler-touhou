import {useEffect, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {createTrackerRenderer, trackerLayout, trackerDisplayName} from './tracker-renderer';
import {blankRecord, cellLabel, DEFAULT_OPTIONS, TRACKER_CELLS, TRACKER_GAMES, validCareerRecords, validOptions,
  type CareerRecords, type TrackerOptions, type TrackerRecord} from './tracker-records';
import {readBookPreference, writeBookPreference} from './book-preferences';
import './career-showcase.css';

type Cell = {key: string; x: number; y: number};
type View = {scale: number; x: number; y: number};
const chartHeight = (options: TrackerOptions) => trackerLayout(options).height;
const completed = (records: CareerRecords) => Object.values(records).filter(record => record.done).length;
function saveFile(name: string, url: string) {const link = document.createElement('a'); link.download = name; link.href = url; link.click();}

function Chart({records, options, onCells}: {records: CareerRecords; options: TrackerOptions; onCells?: (cells: Cell[]) => void}) {
  const own = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = own.current;
    if (!canvas) return;
    const renderer = createTrackerRenderer(canvas);
    let active = true;
    const draw = () => {if (active) {const cells = renderer.draw(records, options, document.documentElement.dataset.bookTheme !== 'light'); onCells?.(cells);}};
    const observer = new MutationObserver(draw);
    observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-book-theme']});
    draw();
    void document.fonts.ready.then(draw);
    return () => {active = false; observer.disconnect();};
  }, [records, options, onCells]);
  return <canvas ref={own} width={800} height={chartHeight(options)} aria-label="东方全作品通关图，使用下方入口放大查看"/>;
}

export function CareerSummary({records}: {records: CareerRecords}) {
  const [expanded, setExpanded] = useState(false);
  const previewHeight = trackerLayout(DEFAULT_OPTIONS).sections[0].rows[1].y - 12;
  return <section className="profile-panel career-overview"><div className="profile-section-title"><h2>东方通关图</h2><span className="career-total"><b>{completed(records)}</b> 项通关</span><button type="button" className="career-overview-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "收起" : "展开"}</button></div>
    <button type="button" className="career-thumbnail" style={expanded ? undefined : {aspectRatio: "800 / " + previewHeight}} data-expanded={expanded} aria-expanded={expanded} onClick={() => setExpanded(value => !value)} aria-label={expanded ? "收起通关图" : "展开通关图"}><Chart records={records} options={DEFAULT_OPTIONS}/></button></section>;
}

export function CareerShowcase({records, onSave, initiallyOpen = false}: {records: CareerRecords; onSave: (next: CareerRecords) => void; initiallyOpen?: boolean}) {
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [helpOpen, setHelpOpen] = useState(false);
  const [open, setOpen] = useState(initiallyOpen), [editing, setEditing] = useState(false), [draft, setDraft] = useState<CareerRecords>({});
  const [selection, setSelection] = useState<string | null>(null), [brush, setBrush] = useState('details');
  const [cells, setCells] = useState<Cell[]>([]), [view, setView] = useState<View>({scale: 1, x: 0, y: 0});
  const [confirmClose, setConfirmClose] = useState(false), [message, setMessage] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), viewport = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null), input = useRef<HTMLInputElement>(null), fitted = useRef(false);
  const pointers = useRef(new Map<number, {x: number; y: number}>()), gesture = useRef({moved: false, startX: 0, startY: 0});
  const shown = editing ? draft : records;
  const height = chartHeight(options);
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(records);
  useEffect(() => {setOptions(readBookPreference('career-chart-options-v1', DEFAULT_OPTIONS, validOptions));}, []);
  const changeOptions = (next: TrackerOptions) => {setOptions(next); writeBookPreference('career-chart-options-v1', next); fitted.current = false;};
  const fit = (whole = false) => {
    const area = viewport.current; if (!area) return;
    const scale = Math.max(.15, Math.min((area.clientWidth - 48) / 800, whole ? (area.clientHeight - 48) / height : 6));
    setView({scale, x: (area.clientWidth - 800 * scale) / 2, y: whole ? (area.clientHeight - height * scale) / 2 : 24}); fitted.current = true;
  };
  const fitRef = useRef(fit); fitRef.current = fit;
  useEffect(() => {
    if (!open) return;
    const openedDialog = dialog.current; openedDialog?.showModal();
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    if (!fitted.current) fitRef.current();
    const observer = new ResizeObserver(() => {if (!fitted.current) fitRef.current();});
    if (viewport.current) observer.observe(viewport.current);
    const resize = () => fitRef.current(); window.addEventListener('resize', resize);
    return () => {observer.disconnect(); window.removeEventListener('resize', resize); document.body.style.overflow = overflow; openedDialog?.close(); pointers.current.clear(); returnFocus.current?.focus();};
  }, [open]);
  useEffect(() => {if (open) fitRef.current();}, [height]);
  const zoom = (factor: number, x?: number, y?: number) => {
    const area = viewport.current; if (!area) return;
    const ax = x ?? area.clientWidth / 2, ay = y ?? area.clientHeight / 2;
    setView(previous => {const scale = Math.max(.15, Math.min(6, previous.scale * factor)); const ratio = scale / previous.scale;
      return {scale, x: ax - (ax - previous.x) * ratio, y: ay - (ay - previous.y) * ratio};});
  };
  useEffect(() => {
    const area = viewport.current; if (!open || !area) return;
    const wheel = (event: WheelEvent) => {event.preventDefault(); const rect = area.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .0015), event.clientX - rect.left, event.clientY - rect.top);};
    area.addEventListener('wheel', wheel, {passive: false});
    return () => area.removeEventListener('wheel', wheel);
  }, [open]);
  const launch = (edit = false) => {returnFocus.current = document.activeElement as HTMLElement; setOpen(true); setConfirmClose(false); if (edit) {setDraft({...records}); setEditing(true);} };
  const close = () => {if (dirty) {setConfirmClose(true); return;} setOpen(false); setEditing(false); setSelection(null);};
  const update = (key: string, record?: TrackerRecord) => setDraft(current => {const next = {...current}; if (record) next[key] = record; else delete next[key]; return next;});
  const select = (key: string) => {
    setSelection(key);
    if (!editing || brush === 'details') return;
    if (brush === 'erase') update(key);
    else update(key, {...(draft[key] ?? blankRecord(key)), done: true, continued: false,
      misses: brush === 'nm' || brush === 'nn' ? '0' : null, bombs: brush === 'nb' || brush === 'nn' ? '0' : null});
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (pointers.current.size === 1) gesture.current = {moved: false, startX: event.clientX, startY: event.clientY};
    else gesture.current.moved = true;
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId); if (!previous) return;
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, {x: event.clientX, y: event.clientY});
    const after = [...pointers.current.values()];
    if (Math.hypot(event.clientX - gesture.current.startX, event.clientY - gesture.current.startY) > 5) gesture.current.moved = true;
    if (before.length === 2) {
      const distance = (points: typeof before) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const oldDistance = distance(before); if (oldDistance < 1) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const oldX = (before[0].x + before[1].x) / 2 - rect.left, oldY = (before[0].y + before[1].y) / 2 - rect.top;
      const newX = (after[0].x + after[1].x) / 2 - rect.left, newY = (after[0].y + after[1].y) / 2 - rect.top;
      setView(view => {const scale = Math.max(.15, Math.min(6, view.scale * distance(after) / oldDistance)); const ratio = scale / view.scale;
        return {scale, x: newX - (oldX - view.x) * ratio, y: newY - (oldY - view.y) * ratio};});
    } else if (before.length === 1 && gesture.current.moved) setView(view => ({...view, x: view.x + event.clientX - previous.x, y: view.y + event.clientY - previous.y}));
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (gesture.current.moved || event.type === 'pointercancel') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left - view.x) / view.scale, y = (event.clientY - rect.top - view.y) / view.scale;
    const cell = cells.find(cell => x >= cell.x && x < cell.x + 17 && y >= cell.y && y < cell.y + 17);
    if (cell) select(cell.key);
  };
  const exportPng = async () => {
    const canvas = document.createElement('canvas'); createTrackerRenderer(canvas).draw(shown, options, document.documentElement.dataset.bookTheme !== 'light');
    saveFile('touhou-1cc-chart.png', canvas.toDataURL('image/png'));
  };
  const exportJson = () => {const url = URL.createObjectURL(new Blob([JSON.stringify({version: 2, records: shown, options}, null, 2)], {type: 'application/json'})); saveFile('touhou-career.json', url); setTimeout(() => URL.revokeObjectURL(url), 1000);};
  return <section className="profile-panel career-showcase" aria-label="东方生涯通关图">
    <div className="profile-section-title career-heading"><h2>东方通关图</h2><span className="career-total"><b>{completed(records)}</b> 项通关</span></div>
    <button type="button" className="career-thumbnail" onClick={() => launch()} aria-label="全屏查看通关图"><Chart records={records} options={options}/></button>
    <div className="career-card-footer"><div><button type="button" onClick={() => launch(true)}>编辑记录</button><button type="button" onClick={exportPng}>导出 PNG</button></div></div>

    {open && <dialog ref={dialog} className="career-viewer" aria-labelledby="career-viewer-title" onCancel={event => {event.preventDefault(); close();}}>
      <header className="career-viewer-header"><div><h2 id="career-viewer-title">{editing ? '编辑通关记录' : '东方通关图'}</h2><span className="career-viewer-count">{completed(shown)} / {TRACKER_CELLS.length}</span></div><div className="career-viewer-actions">
        {editing ? <><button type="button" onClick={() => {if (dirty) setConfirmClose(true); else {setEditing(false); setSelection(null);}}}>取消编辑</button><button type="button" className="is-primary" onClick={() => {onSave(draft); setEditing(false); setSelection(null); setConfirmClose(false); setMessage('通关记录已保存到此浏览器');}}>保存记录</button></> : <button type="button" onClick={() => {setDraft({...records}); setEditing(true);}}>编辑记录</button>}
        <button type="button" className="career-help-trigger" onClick={() => setHelpOpen(true)}><span aria-hidden="true">?</span>说明</button><button type="button" onClick={exportPng}>导出 PNG</button><button type="button" aria-label="关闭全屏通关图" onClick={close}>×</button></div></header>
      {confirmClose && <div className="career-discard" role="alert">还有未保存的修改。<button type="button" onClick={() => setConfirmClose(false)}>继续编辑</button><button type="button" onClick={() => {setConfirmClose(false); setEditing(false); setOpen(false); setSelection(null);}}>放弃修改并关闭</button></div>}
      <div className="career-viewer-body"><div className="career-map-column">
        <div className="career-map-tools"><div><button type="button" aria-label="缩小通关图" onClick={() => zoom(1 / 1.25)}>−</button><output aria-label="缩放比例">{Math.round(view.scale * 100)}%</output><button type="button" aria-label="放大通关图" onClick={() => zoom(1.25)}>＋</button><button type="button" onClick={() => fit(true)}>适应屏幕</button><button type="button" onClick={() => zoom(1 / view.scale)}>原始大小</button></div><span>{editing ? '选择格子填写记录' : '滚轮缩放 · 拖动平移 · 双指缩放'}</span></div>
        <div className="career-map-viewport" ref={viewport} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={event => pointers.current.delete(event.pointerId)}>
          <div className="career-map-sheet" style={{width: 800, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`}}>
            <Chart records={shown} options={options} onCells={setCells}/>
            {cells.map(cell => <button type="button" key={cell.key} tabIndex={selection === cell.key ? 0 : -1} data-cell-key={cell.key} className={`career-map-cell${selection === cell.key ? ' is-selected' : ''}`} style={{left: cell.x, top: cell.y}} aria-label={`${cellLabel(cell.key)} · ${shown[cell.key]?.done ? '已通关' : '尚无通关'}`} aria-pressed={!!shown[cell.key]?.done} title={cellLabel(cell.key)} onClick={event => {if (event.detail === 0) select(cell.key);}} onFocus={event => {if (event.currentTarget.matches(':focus-visible')) {setSelection(cell.key); setView(view => ({...view, x: (viewport.current?.clientWidth ?? 800) / 2 - cell.x * view.scale, y: (viewport.current?.clientHeight ?? 600) / 2 - cell.y * view.scale}));}}}/>)}
          </div>
        </div>
        <footer className="career-map-footer"><span>{completed(shown)} 项通关 · {cells.length} 个格子</span></footer>
      </div>
      <aside className="career-map-sidebar">
        {editing && <section className="career-tool-section"><h3>填表工具</h3><div className="career-brushes">{[['details', '单格详情'], ['1cc', '1CC'], ['nm', 'NM'], ['nb', 'NB'], ['nn', 'NN'], ['erase', '擦除']].map(([id, label]) => <button type="button" key={id} aria-pressed={brush === id} onClick={() => setBrush(id)}>{label}</button>)}</div></section>}
        <section className="career-tool-section"><div className="career-detail-title"><h3>{selection ? cellLabel(selection) : '格子详情'}</h3><button type="button" className="career-detail-help" aria-label="查看格子说明" onClick={() => setHelpOpen(true)}>?</button></div>
          {selection ? <CellEditor key={selection + JSON.stringify(shown[selection])} record={shown[selection] ?? blankRecord(selection)} editing={editing && brush === 'details'} onApply={record => update(selection, record)}/>
          : <p>选择格子查看记录。</p>}
          <label className="career-cell-jump">快速查找格子<select aria-label="快速查找格子" value={selection ?? ''} onChange={event => {const key = event.target.value; if (!key) return; setSelection(key); const cell = cells.find(cell => cell.key === key); if (cell) setView({scale: 2, x: (viewport.current?.clientWidth ?? 800) / 2 - cell.x * 2, y: (viewport.current?.clientHeight ?? 600) / 2 - cell.y * 2});}}><option value="">选择作品 / 机体 / 难度</option>{TRACKER_GAMES.filter(game => options.extra || !['IAMP', 'SWR', 'H.SOKU', 'HM', 'ULIL', 'AOCF', 'GI'].includes(game.name)).map(game => <optgroup key={game.name} label={game.title}>{TRACKER_CELLS.filter(cell => cell.game.name === game.name && (options.easy || !cell.difficulty.endsWith('E'))).map(cell => <option key={cell.key} value={cell.key}>{cell.character} · {cell.difficulty}</option>)}</optgroup>)}</select></label>
        </section>
        <section className="career-tool-section"><h3>图表显示</h3>{([['easy', '显示 Easy'], ['extra', '显示附加作品'], ['transparent', '透明 PNG 背景']] as const).map(([key, label]) => <label className="career-check" key={key}><input type="checkbox" checked={options[key]} onChange={event => changeOptions({...options, [key]: event.target.checked})}/>{label}</label>)}</section>
        <section className="career-tool-section"><h3>本地备份</h3><div className="career-backup-actions"><button type="button" onClick={exportJson}>导出 JSON</button><button type="button" onClick={() => input.current?.click()}>导入 JSON</button></div><input hidden ref={input} type="file" accept="application/json,.json" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          try {if (file.size > 2_000_000) throw new Error(); const data = JSON.parse(await file.text()); if (data.version !== 2 || !validCareerRecords(data.records)) throw new Error();
            setDraft(data.records); setEditing(true); setSelection(null); setMessage('备份已载入草稿，保存记录后生效'); if (validOptions(data.options)) changeOptions(data.options);
          } catch {setMessage('无法导入：请选择有效的生涯 JSON 备份');}
        }}/><p>导入后先预览，再保存整张通关图。</p></section>
      </aside></div>{message && <div className="career-viewer-status" role="status">{message}</div>}
    {helpOpen && <CareerHelp onClose={() => setHelpOpen(false)}/>}
    </dialog>}
  </section>;
}

function CellEditor({record, editing, onApply}: {record: TrackerRecord; editing: boolean; onApply: (record?: TrackerRecord) => void}) {
  if (!editing) return <div className="career-record-description"><strong className={record.done ? 'is-complete' : ''}>{record.done ? '已通关 · 1CC' : record.continued ? '续关通关' : '尚无记录'}</strong><dl className="career-record-counts">{[['Miss', record.misses], ['Bomb', record.bombs], ['初始残机', record.lives]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}</dl><div className="career-record-tags">{[record.vertical && 'NV', record.focus && 'NF', record.pacifist && 'P', record.unique && 'U', record.challenge].filter(Boolean).map(tag => <span key={String(tag)}>{tag}</span>)}</div>{record.note && <p className="career-record-note">{record.note}</p>}</div>;
  return <form className="career-cell-form" onSubmit={event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const next = {...record};
    for (const key of ['done', 'vertical', 'focus', 'pacifist', 'unique'] as const) next[key] = data.has(key);
    for (const key of ['misses', 'bombs', 'lives'] as const) next[key] = String(data.get(key) ?? '') || null;
    next.continued = data.has('continued');
    next.cellColour = '#ffffff'; next.textColour = '#000000';
    next.note = String(data.get('note') ?? '').trim(); next.challenge = String(data.get('challenge') ?? '').trim();
    onApply(next);
  }}>
    <label className="career-check"><input type="checkbox" name="done" defaultChecked={record.done}/>标记 1CC</label>
    <label className="career-check"><input type="checkbox" name="continued" defaultChecked={record.continued}/>另记续关通关</label>
    <div className="career-count-fields">{([['misses', 'Miss'], ['bombs', 'Bomb'], ['lives', '初始残机']] as const).map(([key, label]) => <label key={key}>{label}<select name={key} aria-label={label} defaultValue={record[key] ?? ''}><option value="">未知</option>{Array.from({length: 10}, (_, n) => <option key={n} value={n}>{n}</option>)}</select></label>)}</div>
    <fieldset><legend>特殊限制</legend>{([['vertical', 'NV · 禁止纵向移动'], ['focus', 'NF · 禁止低速'], ['pacifist', 'P · 和平主义'], ['unique', 'U · 自定义限制']] as const).map(([key, label]) => <label className="career-check" key={key}><input type="checkbox" name={key} defaultChecked={record[key]}/>{label}</label>)}</fieldset>
    <label>自定义标记<input name="challenge" maxLength={24} defaultValue={record.challenge}/></label><label>备注<textarea name="note" rows={2} maxLength={240} defaultValue={record.note}/></label>
    <div className="career-backup-actions"><button type="button" onClick={() => onApply()}>移除此格</button><button className="is-primary" type="submit">应用到草稿</button></div>
  </form>;
}

function CareerHelp({onClose}: {onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opened = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    opened?.showModal();
    return () => {opened?.close(); previous?.focus();};
  }, []);
  return <dialog ref={dialog} className="career-help-dialog" aria-labelledby="career-help-title" onCancel={event => {event.preventDefault(); event.stopPropagation(); onClose();}}>
    <header><h2 id="career-help-title">通关图说明</h2><button type="button" aria-label="关闭说明" onClick={onClose}>×</button></header>
    <div className="career-help-content">
      <section><h3>格子怎么读</h3><div className="career-help-example"><div className="career-example-cell" aria-label="示例：2 Miss，0 Bomb，初始残机 3，NF 限制"><span>2</span><span>0</span><span>3</span><b>F</b></div><p>每格对应一个机体、路线和难度。顶部从左到右为 Miss、Bomb、初始残机；下方为特殊限制标记。作品配色表示已标记 1CC。</p></div></section>
      <section><h3>难度与通关</h3><dl className="career-help-definitions"><div><dt>E / N / H / L</dt><dd>Easy / Normal / Hard / Lunatic</dd></div><div><dt>X / P</dt><dd>Extra / Phantasm</dd></div><div><dt>1CC</dt><dd>不使用续关完成对应流程。</dd></div><div><dt>NM / NB / NN</dt><dd>同一次 1CC 的无 Miss / 无 Bomb / 双无记录。</dd></div></dl><p>次数留空表示未知，0 表示本次没有使用或发生。续关通关独立记录，不计入 1CC 数量。</p></section>
      <section><h3>特殊限制</h3><dl className="career-help-definitions"><div><dt>横线 / NV</dt><dd>禁止纵向移动</dd></div><div><dt>F / NF</dt><dd>禁止低速</dd></div><div><dt>P</dt><dd>和平主义</dd></div><div><dt>U</dt><dd>自定义限制，具体规则填入备注。</dd></div></dl></section>
      <section><h3>路线与模式</h3><dl className="career-help-definitions"><div><dt>永夜抄 A / B</dt><dd>Final A / Final B 路线</dd></div><div><dt>绀珠传 p / l</dt><dd>绀珠模式 / 传统模式</dd></div><div><dt>天空璋 sp / sm / f / w</dt><dd>春 / 夏 / 秋 / 冬季节</dd></div><div><dt>e1 / e2</dt><dd>对应作品的两种结局记录</dd></div></dl><p>摄影作等作品沿用原图的场景与完成标记；记录时可在备注中补充条件。</p></section>
      <section><h3>查看与编辑</h3><p>滚轮或双指缩放，拖动画布移动。「适应屏幕」查看全图，「原始大小」返回 100%。</p><p>进入编辑后，选格子填写详情并应用到草稿；也可选择填表工具快速标记。点击「保存记录」保存整张图。</p><p>PNG 导出当前显示的通关图；JSON 用于备份和恢复记录。</p></section>
      <section><h3>作品编号</h3><dl className="career-help-games">{TRACKER_GAMES.map(game => <div key={game.name}><dt><i style={{background: game.colour}}/>{trackerDisplayName(game)}</dt><dd>{game.title}</dd></div>)}</dl></section>
    </div>
  </dialog>;
}
