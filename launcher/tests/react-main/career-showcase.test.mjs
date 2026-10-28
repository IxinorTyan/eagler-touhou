import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {authoredSourcesPlugin} from './authored-sources.mjs';
import {installMountedDom} from './mounted-dom-environment.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
let env, React, createRoot, api, work, root;
before(async () => {
  env = installMountedDom(); React = await import('react'); ({createRoot} = await import('react-dom/client'));
  work = await mkdtemp(resolve(project, '.cache/career-showcase-'));
  const outfile = resolve(work, 'views.mjs');
  await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'tsx', contents: `
    export {CareerShowcase, CareerSummary} from './app/components/launcher/CareerShowcase.tsx';
    export * from './app/components/launcher/career-records.ts';
    export * from './app/components/launcher/book-preferences.ts';
  `}, outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', logLevel: 'silent', plugins: [authoredSourcesPlugin(project)]});
  api = await import(pathToFileURL(outfile).href);
});
afterEach(async () => {
  if (root) await React.act(async () => root.unmount()); root = null;
  env.document.body.replaceChildren(); env.window.localStorage.clear();
  assert.deepEqual(env.errors.splice(0), []);
});
after(async () => {env.close(); await rm(work, {recursive: true, force: true});});
const node = selector => {const element = env.document.querySelector(selector); assert.ok(element, selector); return element;};
const click = selector => React.act(async () => node(selector).click());
const clickText = text => React.act(async () => {
  const button = [...env.document.querySelectorAll('button')].find(button => button.textContent === text);
  assert.ok(button, text); button.click();
});

test('solo rules reject impossible cells and preserve independent difficulty records', () => {
  const game = id => api.CAREER_GAMES.find(game => game.id === id);
  assert.equal(api.careerCellAvailable(game('th06'), 'Easy'), false);
  assert.ok(game('th07').difficulties.includes('Phantasm'));
  assert.equal(game('th08').loadouts.length, 12);
  assert.equal(game('th09').loadouts.length, 14);
  assert.ok(game('th11').loadouts[0].label.includes('紫'));
  assert.equal(game('th20'), undefined);
  const key = api.careerCellKey(game('th06'), 'Lunatic', game('th06').loadouts[0].id);
  assert.equal(api.validCareerRecords({[key]: true}), true);
  assert.equal(api.validCareerRecords({[key]: false}), false);
  assert.equal(api.validCareerRecords({'th06:Easy:0-0': true}), false);
  assert.equal(api.validCareerRecords({'unpublished-game:Normal:0-0': true}), false);
  assert.deepEqual(api.careerDifficulties(game('th06'), {[key]: true}), ['Lunatic']);
});

test('career changes remain drafts until saved; cancel, local reload, summary and clear work together', async () => {
  function Fixture() {
    const [records, setRecords] = React.useState(() => api.readBookPreference(api.CAREER_STORAGE_KEY, {}, api.validCareerRecords));
    return React.createElement(React.Fragment, {},
      React.createElement(api.CareerSummary, {records, onOpen() {}}),
      React.createElement(api.CareerShowcase, {records, onSave(next) {api.writeBookPreference(api.CAREER_STORAGE_KEY, next); setRecords(next);}}));
  }
  const container = env.document.createElement('div'); env.document.body.append(container);
  const mount = async () => {root = createRoot(container); await React.act(async () => root.render(React.createElement(Fixture)));};
  await mount();
  const cell = '[data-career-game="th06"] .career-cell';
  assert.equal(node('#career-table-th07').getAttribute('aria-hidden'), 'true');
  assert.equal(node('#career-table-th07').hasAttribute('inert'), true);
  await click('[data-career-game="th07"] .career-game-toggle');
  assert.equal(node('#career-table-th06').hasAttribute('inert'), true);
  assert.equal(node('#career-table-th07').hasAttribute('inert'), false);
  await click('[data-career-game="th06"] .career-game-toggle');
  await click(cell); assert.equal(node(cell).getAttribute('aria-pressed'), 'false');
  assert.ok(node('.career-selection').textContent.includes('Normal'));
  await clickText('编辑生涯'); await click('.career-brushes [data-status="1cc"]'); await click(cell);
  assert.equal(node(cell).getAttribute('aria-pressed'), 'true');
  assert.ok(node('.career-overview').textContent.includes('尚未记录通关'));
  await clickText('取消'); assert.equal(node(cell).getAttribute('aria-pressed'), 'false');
  await clickText('编辑生涯'); await click('.career-brushes [data-status="1cc"]'); await click(cell); await clickText('保存记录');
  assert.ok(node('.career-summary-list').textContent.includes('Normal'));
  assert.equal(Object.keys(JSON.parse(env.window.localStorage.getItem('eagler.book.' + api.CAREER_STORAGE_KEY))).length, 1);
  await React.act(async () => root.unmount()); root = null; await mount();
  assert.equal(node(cell).getAttribute('aria-pressed'), 'true');
  await clickText('编辑生涯'); await clickText('清空记录'); await clickText('清空');
  assert.equal(node(cell).getAttribute('aria-pressed'), 'false');
  await clickText('取消'); assert.equal(node(cell).getAttribute('aria-pressed'), 'true');
  await clickText('编辑生涯'); await clickText('清空记录'); await clickText('清空'); await clickText('保存记录');
  assert.ok(node('.career-overview').textContent.includes('尚未记录通关'));
});

test('records distinguish independent achievements, unknown counts and continued clears', () => {
  const game = api.CAREER_GAMES[0];
  const keys = game.loadouts.map(loadout => api.careerCellKey(game, 'Normal', loadout.id));
  const records = {[keys[0]]: api.careerPreset('nm'), [keys[1]]: api.careerPreset('nb'), [keys[2]]: api.careerPreset('clear'), [keys[3]]: true};
  assert.equal(api.validCareerRecords(records), true);
  assert.equal(api.careerCount(game, records), 3);
  assert.equal(api.careerBest(game, 'Normal', records), 'NM / NB');
  assert.deepEqual(api.careerRecord(true), {status: '1cc'});
  assert.equal(api.careerWithCounts({status: '1cc'}, undefined, undefined).status, '1cc');
  assert.equal(api.careerWithCounts({status: '1cc'}, 0, 0).status, 'nn');
  assert.equal(api.careerWithCounts({status: 'clear'}, 0, 0).status, 'clear');
  assert.equal(api.careerWithCounts(api.careerPreset('nn'), 2, 0).status, 'nb');
  for (const value of [{status: 'nn'}, {status: 'nb', bombs: 1}, {status: '1cc', misses: -1},
    {status: '1cc', bombs: 1.2}, {status: '1cc', misses: Infinity}, {status: '1cc', restrictions: ['bogus']},
    {status: '1cc', restrictions: ['nf', 'nf']}, {status: '1cc', challenge: 'a'.repeat(25)}, {status: '1cc', note: 'a'.repeat(241)}]) {
    assert.equal(api.validCareerRecords({[keys[0]]: value}), false, JSON.stringify(value));
  }
  assert.equal(api.validCareerRecords({[keys[0]]: {status: 'nn', misses: 0, bombs: 0, restrictions: ['nf', 'special'], note: '无结界'}}), true);
});

test('brushes, detail counts, restrictions, erasing and persistence preserve the actual run', async () => {
  const game = api.CAREER_GAMES[0], oldKey = api.careerCellKey(game, 'Hard', game.loadouts[0].id);
  function Fixture() {
    const [records, setRecords] = React.useState(() => api.readBookPreference(api.CAREER_STORAGE_KEY, {[oldKey]: true}, api.validCareerRecords));
    return React.createElement(api.CareerShowcase, {records, onSave(next) {api.writeBookPreference(api.CAREER_STORAGE_KEY, next); setRecords(next);}});
  }
  const container = env.document.createElement('div'); env.document.body.append(container); root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Fixture)));
  const cell = '[data-career-game="th06"] tr[data-difficulty="normal"] .career-cell';
  const change = async (selector, value) => React.act(async () => {
    const element = node(selector);
    const prototype = element.tagName === 'SELECT' ? env.window.HTMLSelectElement.prototype : env.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new env.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));
  });
  await clickText('编辑生涯'); await click('.career-brushes [data-status="nn"]'); await click(cell);
  assert.equal(node(cell).dataset.status, 'nn');
  await clickText('单格详情'); await click(cell);
  assert.equal(node('input[aria-label="Miss 次数"]').value, '0');
  await change('input[aria-label="Miss 次数"]', '2');
  await click('input[name="nf"]');
  await clickText('应用到草稿');
  assert.equal(node(cell).dataset.status, 'nb');
  assert.ok(node(cell).textContent.includes('2M · NF'));
  await change('select[aria-label="通关方式"]', 'clear'); await clickText('应用到草稿');
  assert.equal(node(cell).dataset.status, 'clear');
  assert.ok(node('.career-toolbar').textContent.includes('1 项 1CC · 1 项续关通关'));
  await clickText('保存记录');
  const saved = JSON.parse(env.window.localStorage.getItem('eagler.book.' + api.CAREER_STORAGE_KEY));
  const key = api.careerCellKey(game, 'Normal', game.loadouts[0].id);
  assert.equal(saved[oldKey], true);
  assert.deepEqual(saved[key], {status: 'clear', misses: 2, bombs: 0, restrictions: ['nf'], challenge: '', note: ''});
  assert.equal(api.validCareerRecords(saved), true);
  await clickText('编辑生涯'); await clickText('擦除'); await click(cell);
  assert.equal(node(cell).getAttribute('aria-pressed'), 'false');
  await clickText('取消'); assert.equal(node(cell).dataset.status, 'clear');
});
