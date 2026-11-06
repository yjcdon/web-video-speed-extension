(() => {
  'use strict';

  const STORAGE_KEY = 'holdSpeed';
  const DEFAULT_SPEED = 3;
  const HOLD_DELAY_MS = 500;
  const USE_NATIVE_KEYS = /(^|\.)(bilibili|douyin)\.com$/.test(location.hostname);

  let configuredSpeed = DEFAULT_SPEED;
  let isRightArrowHeld = false;
  let holdTimer = 0;
  let holdCandidateVideo = null;
  let acceleratedVideo = null;
  let speedBeforeHold = 1;
  let enforceFrame = 0;

  chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_SPEED }, (result) => {
    configuredSpeed = normalizeSpeed(result[STORAGE_KEY]);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[STORAGE_KEY]) return;
    configuredSpeed = normalizeSpeed(changes[STORAGE_KEY].newValue);
    if (acceleratedVideo) setPlaybackRate(acceleratedVideo, configuredSpeed);
  });

  function normalizeSpeed(value) {
    const speed = Number(value);
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 16) return DEFAULT_SPEED;
    return Math.round(speed * 4) / 4;
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    return target.isContentEditable || Boolean(target.closest('input, textarea, select, [role="textbox"]'));
  }

  /** 按当前视口内的实际可见面积选择视频，排除滚动到屏幕外的播放器。 */
  function visibleArea(video) {
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    if (style.display === 'none' || style.visibility === 'hidden') return 0;
    const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  /** 选择当前页面或嵌入框架内可见、正在播放的视频，再按可见面积优先。 */
  function findPlayerVideo() {
    const videos = [...document.querySelectorAll('video')]
      .map(video => ({ video, area: visibleArea(video) }))
      .filter(({ video, area }) => area > 0 && !video.ended);
    if (!videos.length) return null;

    return videos.sort((a, b) => {
      if (a.video.paused !== b.video.paused) return a.video.paused ? 1 : -1;
      return b.area - a.area;
    })[0].video;
  }

  function setPlaybackRate(video, speed) {
    if (!video || !video.isConnected) return;
    if (Math.abs(video.playbackRate - speed) > 0.001) video.playbackRate = speed;
  }

  function beginAcceleration() {
    if (!isRightArrowHeld || acceleratedVideo) return;
    const video = holdCandidateVideo;
    if (!video?.isConnected) return;

    acceleratedVideo = video;
    setPlaybackRate(video, configuredSpeed);
    enforceConfiguredSpeed();
  }

  function enforceConfiguredSpeed() {
    cancelAnimationFrame(enforceFrame);
    if (!isRightArrowHeld || !acceleratedVideo) return;

    // B站长按期间可能反复写入固定 3 倍速，每帧校正可避免被抢回。
    setPlaybackRate(acceleratedVideo, configuredSpeed);
    enforceFrame = requestAnimationFrame(enforceConfiguredSpeed);
  }

  function endAcceleration() {
    clearTimeout(holdTimer);
    holdTimer = 0;
    cancelAnimationFrame(enforceFrame);
    enforceFrame = 0;

    const video = acceleratedVideo;
    const restoreSpeed = speedBeforeHold;
    acceleratedVideo = null;
    holdCandidateVideo = null;
    if (!video) return;

    setTimeout(() => setPlaybackRate(video, restoreSpeed), 0);
    setTimeout(() => {
      if (!isRightArrowHeld && !acceleratedVideo) setPlaybackRate(video, restoreSpeed);
    }, 120);
  }

  /** 开始识别右方向键长按；通用网站接管按键以阻止默认跳秒。 */
  function onKeyDown(event) {
    if (event.code !== 'ArrowRight') return;
    // 从第一次按下起拦截通用网站的跳秒，包括系统自动产生的重复按键。
    if (!USE_NATIVE_KEYS && isRightArrowHeld) {
      consumeKey(event);
      return;
    }
    if (
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      event.composedPath().some(isEditableTarget) || event.repeat || isRightArrowHeld
    ) return;

    holdCandidateVideo = findPlayerVideo();
    if (!holdCandidateVideo) return;
    if (!USE_NATIVE_KEYS) consumeKey(event);
    isRightArrowHeld = true;
    if (holdCandidateVideo) speedBeforeHold = holdCandidateVideo.playbackRate;
    holdTimer = window.setTimeout(beginAcceleration, HOLD_DELAY_MS);
  }

  /** 松开结束临时倍速，通用网站未达到长按阈值时执行一次快进。 */
  function onKeyUp(event) {
    if (event.code !== 'ArrowRight' || !isRightArrowHeld) return;
    if (!USE_NATIVE_KEYS) {
      consumeKey(event);
      if (!acceleratedVideo) seekForward(holdCandidateVideo);
    }
    isRightArrowHeld = false;
    endAcceleration();
  }

  /** 阻止网站对插件已接管的右方向键执行默认操作。 */
  function consumeKey(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  /** 通用网站短按松开时快进五秒；直播只在可回看的时间范围内跳转。 */
  function seekForward(video) {
    if (!video?.isConnected) return;
    const end = Number.isFinite(video.duration)
      ? video.duration
      : video.seekable.length ? video.seekable.end(video.seekable.length - 1) : NaN;
    if (Number.isFinite(end)) video.currentTime = Math.min(video.currentTime + 5, end);
  }

  function cancelHold() {
    if (!isRightArrowHeld && !acceleratedVideo) return;
    isRightArrowHeld = false;
    endAcceleration();
  }

  // B站和抖音只观察按键；其他站点接管右方向键以区分短按快进和长按倍速。
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', cancelHold, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelHold();
  });
})();
