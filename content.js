(() => {
  'use strict';

  const STORAGE_KEY = 'holdSpeed';
  const DEFAULT_SPEED = 3;
  const HOLD_DELAY_MS = 500;
  const IS_YOUTUBE = location.hostname === 'www.youtube.com' || location.hostname === 'youtube.com';

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

  function isVisible(video) {
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  /** 选择当前可见的主视频，YouTube 仅在受支持的播放页面启用。 */
  function findPlayerVideo() {
    // YouTube 首页也有预览视频，仅接管常规播放页、直播页和独立嵌入页的主播放器。
    if (IS_YOUTUBE && !/^\/(watch$|live\/|embed\/)/.test(location.pathname)) return null;
    const selector = IS_YOUTUBE ? '#movie_player video' : 'video';
    const videos = [...document.querySelectorAll(selector)].filter(isVisible);
    if (!videos.length) return null;

    return videos.sort((a, b) => {
      if (a.paused !== b.paused) return a.paused ? 1 : -1;
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return bRect.width * bRect.height - aRect.width * aRect.height;
    })[0];
  }

  function setPlaybackRate(video, speed) {
    if (!video || !video.isConnected) return;
    if (Math.abs(video.playbackRate - speed) > 0.001) video.playbackRate = speed;
  }

  function beginAcceleration() {
    if (!isRightArrowHeld || acceleratedVideo) return;
    const video = holdCandidateVideo?.isConnected ? holdCandidateVideo : findPlayerVideo();
    if (!video) return;

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

  /** 开始识别无修饰键的右键长按；YouTube 同时接管首次按下和自动重复。 */
  function onKeyDown(event) {
    if (event.code !== 'ArrowRight') return;
    // 从第一次按下起拦截 YouTube 的跳秒，包括系统自动产生的重复按键。
    if (IS_YOUTUBE && isRightArrowHeld) {
      consumeKey(event);
      return;
    }
    if (
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      isEditableTarget(event.target) || event.repeat || isRightArrowHeld
    ) return;

    holdCandidateVideo = findPlayerVideo();
    if (IS_YOUTUBE && !holdCandidateVideo) return;
    if (IS_YOUTUBE) consumeKey(event);
    isRightArrowHeld = true;
    if (holdCandidateVideo) speedBeforeHold = holdCandidateVideo.playbackRate;
    holdTimer = window.setTimeout(beginAcceleration, HOLD_DELAY_MS);
  }

  /** 松开结束临时倍速，YouTube 未达到长按阈值时执行一次快进。 */
  function onKeyUp(event) {
    if (event.code !== 'ArrowRight' || !isRightArrowHeld) return;
    if (IS_YOUTUBE) {
      consumeKey(event);
      if (!acceleratedVideo) seekForward(holdCandidateVideo);
    }
    isRightArrowHeld = false;
    endAcceleration();
  }

  /** 阻止 YouTube 对已接管的右方向键执行跳秒，其他站点继续使用原生按键。 */
  function consumeKey(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  /** YouTube 短按松开时快进五秒；直播只在可回看的时间范围内跳转。 */
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

  // B站和抖音只观察按键；YouTube 接管右方向键以区分短按快进和长按倍速。
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', cancelHold, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelHold();
  });
})();
