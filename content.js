(() => {
  'use strict';

  const STORAGE_KEY = 'holdSpeed';
  const DEFAULT_SPEED = 3;
  const HOLD_DELAY_MS = 420;

  let configuredSpeed = DEFAULT_SPEED;
  let isRightArrowHeld = false;
  let holdTimer = 0;
  let holdCandidateVideo = null;
  let acceleratedVideo = null;
  let speedBeforeHold = 1;
  let enforceFrame = 0;
  let toastTimer = 0;

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
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
  }

  function isVisible(video) {
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function findPlayerVideo() {
    const videos = [...document.querySelectorAll('video')].filter(isVisible);
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
    showToast(`长按加速：${configuredSpeed.toFixed(2)}×`);
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

  function onKeyDown(event) {
    if (
      event.code !== 'ArrowRight' ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      isEditableTarget(event.target) || event.repeat || isRightArrowHeld
    ) return;

    isRightArrowHeld = true;
    holdCandidateVideo = findPlayerVideo();
    if (holdCandidateVideo) speedBeforeHold = holdCandidateVideo.playbackRate;
    holdTimer = window.setTimeout(beginAcceleration, HOLD_DELAY_MS);
  }

  function onKeyUp(event) {
    if (event.code !== 'ArrowRight' || !isRightArrowHeld) return;
    isRightArrowHeld = false;
    endAcceleration();
  }

  function cancelHold() {
    if (!isRightArrowHeld && !acceleratedVideo) return;
    isRightArrowHeld = false;
    endAcceleration();
  }

  function showToast(message) {
    const oldToast = document.getElementById('bilibili-hold-speed-toast');
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.id = 'bilibili-hold-speed-toast';
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      left: '50%',
      top: '18%',
      zIndex: '2147483647',
      transform: 'translateX(-50%)',
      padding: '10px 16px',
      borderRadius: '7px',
      color: '#fff',
      background: 'rgba(0, 0, 0, 0.76)',
      font: '14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      pointerEvents: 'none',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)'
    });
    (document.body || document.documentElement).appendChild(toast);
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.remove(), 1500);
  }

  // 只观察按键，不阻止事件传播；短按和松开仍完整交给 B站播放器处理。
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', cancelHold, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelHold();
  });
})();
