import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {mkdir, writeFile} from 'node:fs/promises';

const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true});
const base = process.argv[2] || 'http://127.0.0.1:5173/';
const click = (page, scope, text) => page.evaluate(({scope, text}) => {
  const button = [...document.querySelectorAll(`${scope} button`)].find(el => el.textContent === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  button.click();
}, {scope, text});
const toggle = (page, label) => page.evaluate(label => {
  [...document.querySelectorAll('.profile-display-options label')].find(el => el.textContent === label).querySelector('input').click();
}, label);
const tabs = page => page.$$eval('.profile-tabs button', elements => elements.map(el => el.textContent));
const overview = page => page.$$eval('.profile-content>.profile-panel h2', elements => elements.map(el => el.textContent));
const savedKey = 'eagler.book.player-profile-display-v1';
try {
  await mkdir('.cache/profile-display', {recursive: true});
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({width: 1440, height: 1000});
  await page.goto(new URL('profile.html', base).href, {waitUntil: 'networkidle2'});
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.$('.profile-cover button'), null);
  assert.deepEqual(await tabs(page), ['概览', '生涯', '游玩记录', '内容', '好友']);
  assert.deepEqual(await overview(page), ['东方通关图', '最近启动', '收藏的游戏']);

  await click(page, '.profile-identity', '编辑展示');
  await toggle(page, '生涯');
  await page.click('[aria-label="上移收藏的游戏"]');
  await click(page, '.profile-display-editor', '取消');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), savedKey), null);
  assert.deepEqual(await overview(page), ['东方通关图', '最近启动', '收藏的游戏']);

  await click(page, '.profile-tabs', '生涯');
  await click(page, '.profile-identity', '编辑展示');
  for (const label of ['好友', '生涯', '游玩记录', '内容', '最近启动']) await toggle(page, label);
  await click(page, '.profile-display-editor', '保存展示');
  assert.deepEqual(await tabs(page), ['概览']);
  assert.deepEqual(await overview(page), ['收藏的游戏']);
  assert.equal(await page.$('.career-showcase'), null);
  await page.reload({waitUntil: 'networkidle2'});
  assert.deepEqual(await tabs(page), ['概览']);
  assert.deepEqual(await overview(page), ['收藏的游戏']);

  await click(page, '.profile-identity', '编辑展示');
  for (const label of ['好友', '生涯', '游玩记录', '内容', '最近启动']) await toggle(page, label);
  await page.click('[aria-label="上移收藏的游戏"]');
  await page.click('[aria-label="上移收藏的游戏"]');
  await click(page, '.profile-display-editor', '保存展示');
  assert.deepEqual(await overview(page), ['收藏的游戏', '东方通关图', '最近启动']);
  await page.reload({waitUntil: 'networkidle2'});
  assert.deepEqual(await overview(page), ['收藏的游戏', '东方通关图', '最近启动']);

  // Recent launches and play-record visibility are independent.
  await click(page, '.profile-identity', '编辑展示'); await toggle(page, '游玩记录');
  await click(page, '.profile-display-editor', '保存展示');
  assert.ok((await overview(page)).includes('最近启动'));
  assert.equal(await page.$$eval('.profile-content button', els => els.some(el => el.textContent === '查看全部 →')), false);
  await click(page, '.profile-identity', '编辑展示'); await toggle(page, '游玩记录'); await toggle(page, '最近启动');
  await click(page, '.profile-display-editor', '保存展示');
  await click(page, '.profile-tabs', '游玩记录');
  assert.deepEqual(await overview(page), ['游玩统计']);

  for (const width of [1440, 390]) {
    await page.setViewport({width, height: 900});
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => document.documentElement.setAttribute('data-book-theme', theme), theme);
      await click(page, '.profile-identity', '编辑展示');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
      await page.screenshot({path: `.cache/profile-display/editor-${width}-${theme}.png`, fullPage: true});
      await click(page, '.profile-display-editor', '取消');
      await click(page, '.profile-tabs', '概览');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
  }
  await click(page, '.profile-identity', '编辑资料');
  assert.equal(await page.$$eval('.profile-image-fields legend', els => els.some(el => el.textContent === '主页封面')), true);
  await page.type('.profile-detail-fields input[maxlength="32"]', '灵梦');
  await page.type('.profile-detail-fields textarea', '幻想乡\n第二行简介');
  assert.equal(await page.$eval('.profile-draft-identity strong', el => el.textContent), '灵梦');
  assert.equal(await page.$eval('.profile-draft-identity p', el => el.textContent), '幻想乡');
  await click(page, '.profile-detail-fields', '＋ 添加链接');
  await page.type('.profile-link-editor input[maxlength="40"]', '主页');
  await page.type('.profile-link-editor input[type="url"]', 'https://example.com/');
  const imageInput = await page.$('input[aria-label="选择头像图片"]');
  await writeFile('.cache/profile-display/avatar.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=', 'base64'));
  await imageInput.uploadFile('.cache/profile-display/avatar.png');
  await page.waitForSelector('.profile-draft-avatar img');
  for (const width of [1440, 390]) {
    await page.setViewport({width, height: 900});
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => document.documentElement.setAttribute('data-book-theme', theme), theme);
      await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({path: `.cache/profile-display/details-${width}-${theme}.png`, fullPage: true});
    }
  }
  await click(page, '.profile-details-editor', '保存资料');
  await page.reload({waitUntil: 'networkidle2'});
  assert.equal(await page.$eval('#profile-name', el => el.textContent), '灵梦');
  assert.equal(await page.$eval('.profile-social-links a', el => el.href), 'https://example.com/');
  assert.ok(await page.$('.profile-avatar img'));
  await click(page, '.profile-identity', '编辑资料');
  await page.type('.profile-detail-fields input[maxlength="32"]', '未保存');
  await click(page, '.profile-details-editor', '取消');
  assert.equal(await page.$eval('#profile-name', el => el.textContent), '灵梦');
  assert.deepEqual(errors, []);
  console.log('PASS: profile visibility, ordering, cancellation, persistence, retained cover editing, mobile and both themes');
} finally {await browser.close();}
