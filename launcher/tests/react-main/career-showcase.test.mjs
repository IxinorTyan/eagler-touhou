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
  await clickText('编辑生涯'); await click(cell);
  assert.equal(node(cell).getAttribute('aria-pressed'), 'true');
  assert.ok(node('.career-overview').textContent.includes('尚未记录通关'));
  await clickText('取消'); assert.equal(node(cell).getAttribute('aria-pressed'), 'false');
  await clickText('编辑生涯'); await click(cell); await clickText('保存记录');
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
