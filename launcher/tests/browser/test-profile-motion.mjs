import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true});
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewport({width, height: 900});
    await page.goto(new URL('profile.html', process.argv[2] || 'http://127.0.0.1:5173/').href, {waitUntil: 'networkidle2'});
    await page.evaluate(() => {
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = update => {
        const transition = start(update);
        window.profileTestTransition = transition;
        return transition;
      };
    });
    const change = async (scope, label) => {
      await page.evaluate(({scope, label}) => [...document.querySelectorAll(`${scope} button`)].find(el => el.textContent.includes(label)).click(), {scope, label});
      const animations = await page.evaluate(async () => {
        await window.profileTestTransition.ready;
        return document.getAnimations().map(animation => animation.animationName);
      });
      assert.ok(animations.includes('profile-content-in'), `${width}/${label}: entering content animates`);
      assert.ok(animations.includes('profile-content-out'), `${width}/${label}: leaving content animates`);
      const snapshot = await page.evaluate(() => ({
        scope: document.documentElement.dataset.profileTransition,
        pageName: getComputedStyle(document.querySelector('.player-profile')).viewTransitionName,
        oldOpacity: getComputedStyle(document.documentElement, '::view-transition-old(profile-content)').opacity,
      }));
      if (['视角：', '好友', '关注'].includes(label)) {
        assert.equal(snapshot.scope, 'content');
        assert.equal(snapshot.pageName, 'none', 'Submenus never animate the whole profile');
      }
      assert.equal(snapshot.oldOpacity, '1', 'Old content stays visible beneath the arriving content');
      await page.evaluate(() => window.profileTestTransition.finished);
      await page.waitForFunction(() => !document.documentElement.classList.contains('profile-transition'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    };
    await change('.profile-actions', '视角：');
    await change('.profile-actions', '视角：');
    await change('.profile-tabs', '好友');
    await change('.profile-social-tools', '关注');
    assert.equal(await page.$eval('.profile-aside', el => getComputedStyle(el).display === 'none'), width <= 780);
    await change('.profile-tabs', '概览');
    assert.equal(await page.$eval('.profile-aside', el => getComputedStyle(el).display === 'none'), false);
    for (const label of ['生涯', '游玩记录', '内容']) {
      await change('.profile-tabs', label);
      assert.equal(await page.$eval('.profile-aside', el => getComputedStyle(el).display === 'none'), width <= 780);
    }
    await change('.profile-actions', '账户设置');
    await change('.profile-settings-heading', '隐私与个性化');
    await change('.profile-settings-heading', '账户与安全');
    await change('.profile-topbar', '返回主页');
  }
  await page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: 'reduce'}]);
  await page.evaluate(() => {window.profileTestTransition = undefined; document.querySelector('.profile-perspective').click();});
  assert.equal(await page.evaluate(() => window.profileTestTransition === undefined), true);
  await page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: 'no-preference'}]);
  await page.evaluate(() => {document.startViewTransition = undefined; document.querySelector('.profile-perspective').click();});
  assert.equal(await page.$eval('.profile-perspective', el => el.getAttribute('aria-pressed')), 'false');
  assert.deepEqual(errors, []);
  console.log('PASS: profile enter/exit, perspective and submenu transitions, narrow layouts, reduced motion and API fallback');
} finally {await browser.close();}
