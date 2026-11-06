const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function setup(hostname = 'www.youtube.com', pathname = '/watch') {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const listeners = new Map();
  let storageListener;
  class Element {
    isContentEditable = false;
    editable = false;
    closest() { return this.editable; }
  }
  const video = {
    playbackRate: 1.5, currentTime: 10, duration: 100,
    paused: false, isConnected: true,
    seekable: { length: 0 },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 })
  };
  let videos = [video];
  const target = new Element();
  const schedule = (fn, ms) => {
    const id = ++nextId;
    timers.set(id, { at: now + ms, fn });
    return id;
  };
  const addEventListener = (name, fn) => listeners.set(name, fn);
  const document = {
    hidden: false, addEventListener,
    querySelectorAll: () => videos,
  };
  const context = {
    location: { hostname, pathname }, Element, document, innerWidth: 1280, innerHeight: 720,
    chrome: { storage: {
      sync: { get: (defaults, fn) => fn(defaults) },
      onChanged: { addListener: fn => { storageListener = fn; } }
    } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => schedule(fn, 16),
    cancelAnimationFrame: id => timers.delete(id),
    addEventListener
  };
  context.window = context;
  vm.runInNewContext(readFileSync(`${__dirname}/content.js`, 'utf8'), context);
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const task = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!task) break;
      timers.delete(task[0]);
      now = task[1].at;
      task[1].fn();
    }
    now = end;
  }
  function key(type, options = {}) {
    const event = {
      code: 'ArrowRight', target, repeat: false,
      defaultPrevented: false, stopped: false,
      composedPath() { return [this.target]; },
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
      ...options
    };
    listeners.get(type)(event);
    // 模拟 YouTube 未被拦截时按下及自动重复造成的原生跳秒。
    if (hostname.includes('youtube') && type === 'keydown' && !event.stopped) video.currentTime += 5;
    return event;
  }
  return { video, target, document, context, advance, key,
    hideVideos: () => { videos = []; },
    setVideos: value => { videos = value; },
    blur: () => listeners.get('blur')(),
    hide: () => { document.hidden = true; listeners.get('visibilitychange')(); },
    speed: value => storageListener({ holdSpeed: { newValue: value } }, 'sync')
  };
}

for (const host of ['www.youtube.com', 'www.bilibili.com', 'www.douyin.com', 'example.com']) {
  test(`${host}: 500ms 进入倍速，松开恢复原速`, () => {
    const s = setup(host);
    s.key('keydown');
    s.advance(499);
    assert.equal(s.video.playbackRate, 1.5);
    s.advance(1);
    assert.equal(s.video.playbackRate, 3);
    s.key('keyup');
    s.advance(120);
    assert.equal(s.video.playbackRate, 1.5);
  });
}

test('YouTube 短按松开仅快进五秒，长按与自动重复不跳秒', () => {
  const s = setup();
  assert.equal(s.key('keydown').defaultPrevented, true);
  assert.equal(s.video.currentTime, 10);
  s.advance(100);
  s.key('keyup');
  assert.equal(s.video.currentTime, 15);
  s.key('keydown');
  s.advance(300);
  s.key('keydown', { repeat: true });
  s.advance(200);
  s.key('keydown', { repeat: true });
  s.speed(4);
  assert.equal(s.video.playbackRate, 4);
  s.key('keyup');
  s.advance(120);
  assert.equal(s.video.currentTime, 15);
  assert.equal(s.video.playbackRate, 1.5);
});

test('YouTube 短按在视频末尾和直播可回看范围内跳转', () => {
  const s = setup();
  s.video.currentTime = 98;
  s.key('keydown'); s.key('keyup');
  assert.equal(s.video.currentTime, 100);
  s.video.duration = Infinity;
  s.video.currentTime = 195;
  s.video.seekable = { length: 1, end: () => 198 };
  s.key('keydown'); s.key('keyup');
  assert.equal(s.video.currentTime, 198);
});

test('B站和抖音继续将短按和重复按键交给网站', () => {
  for (const host of ['www.bilibili.com', 'www.douyin.com']) {
    const s = setup(host);
    assert.equal(s.key('keydown').stopped, false);
    assert.equal(s.key('keydown', { repeat: true }).stopped, false);
    assert.equal(s.key('keyup').stopped, false);
    s.advance(600);
    assert.equal(s.video.playbackRate, 1.5);
  }
});

test('输入框、可编辑区域、组合键和其他方向键保留原行为', () => {
  for (const options of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { code: 'ArrowLeft' }]) {
    const s = setup();
    assert.equal(s.key('keydown', options).stopped, false);
    s.advance(500);
    assert.equal(s.video.playbackRate, 1.5);
  }
  for (const field of ['editable', 'isContentEditable']) {
    const s = setup();
    s.target[field] = true;
    assert.equal(s.key('keydown').stopped, false);
  }
});

test('失焦或隐藏取消长按，且不将取消当作短按快进', () => {
  for (const action of ['blur', 'hide']) {
    for (const duration of [100, 600]) {
      const s = setup();
      s.key('keydown'); s.advance(duration); s[action](); s.advance(600);
      assert.equal(s.video.playbackRate, 1.5);
      assert.equal(s.video.currentTime, 10);
    }
  }
});

test('无视频页面保留原按键', () => {
  const s = setup();
  s.hideVideos();
  assert.equal(s.key('keydown').stopped, false);
});

test('普通网站无需原生快捷键即可短按快进、长按倍速并恢复', () => {
  const s = setup('example.com', '/course/lesson');
  s.key('keydown'); s.advance(100); s.key('keyup');
  assert.equal(s.video.currentTime, 15);
  s.key('keydown'); s.advance(500);
  assert.equal(s.video.playbackRate, 3);
  assert.equal(s.key('keydown', { repeat: true }).stopped, true);
  s.key('keyup'); s.advance(120);
  assert.equal(s.video.playbackRate, 1.5);
  assert.equal(s.video.currentTime, 15);
});

test('播放中的视频优先于面积更大的暂停视频', () => {
  const s = setup('example.com');
  const paused = { ...s.video, paused: true,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 700 }) };
  s.setVideos([paused, s.video]);
  s.key('keydown'); s.advance(500);
  assert.equal(s.video.playbackRate, 3);
  assert.equal(paused.playbackRate, 1.5);
});

test('多个播放中视频按可见面积选择，屏幕外、隐藏和已结束的视频不接管', () => {
  const s = setup('example.com');
  const small = { ...s.video,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }) };
  const offscreen = { ...s.video,
    getBoundingClientRect: () => ({ left: 0, top: 900, right: 1200, bottom: 1800 }) };
  s.setVideos([small, offscreen, s.video]);
  s.key('keydown'); s.advance(500);
  assert.equal(s.video.playbackRate, 3);
  assert.equal(small.playbackRate, 1.5);
  assert.equal(offscreen.playbackRate, 1.5);
  s.key('keyup'); s.advance(120);
  s.setVideos([offscreen]);
  assert.equal(s.key('keydown').stopped, false);
  s.setVideos([s.video]);
  s.context.getComputedStyle = () => ({ display: 'none', visibility: 'visible' });
  assert.equal(s.key('keydown').stopped, false);
  s.context.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  s.video.ended = true;
  assert.equal(s.key('keydown').stopped, false);
});

test('识别目标移除后不切换并修改另一个视频', () => {
  const s = setup('example.com');
  const other = { ...s.video };
  s.key('keydown');
  s.video.isConnected = false;
  s.setVideos([other]);
  s.advance(500); s.key('keyup');
  assert.equal(other.playbackRate, 1.5);
  assert.equal(other.currentTime, 10);
});

test('嵌入播放器来源和 about:blank 框架使用通用按键规则', () => {
  for (const [host, path] of [['player.example.com', '/embed/1'], ['', 'blank']]) {
    const s = setup(host, path);
    assert.equal(s.key('keydown').stopped, true);
    s.advance(500);
    assert.equal(s.video.playbackRate, 3);
    s.key('keyup'); s.advance(120);
    assert.equal(s.video.playbackRate, 1.5);
  }
});

test('Shadow DOM 内的输入区域在事件目标重定向后仍保留光标操作', () => {
  for (const field of ['editable', 'isContentEditable']) {
    const s = setup('example.com');
    const input = new s.context.Element();
    input[field] = true;
    const event = s.key('keydown', { composedPath: () => [input, s.target] });
    assert.equal(event.stopped, false);
    s.advance(600);
    assert.equal(s.video.playbackRate, 1.5);
  }
});
