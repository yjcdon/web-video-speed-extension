(() => {
  'use strict';

  const STORAGE_KEY = 'holdSpeed';
  const DEFAULT_SPEED = 3;
  const slider = document.getElementById('speedSlider');
  const output = document.getElementById('speedOutput');
  const presetButtons = [...document.querySelectorAll('[data-speed]')];

  function formatSpeed(speed) {
    return `${Number(speed).toFixed(2)}×`;
  }

  function render(speed) {
    const value = Number(speed);
    slider.value = String(value);
    output.value = formatSpeed(value);
    output.textContent = formatSpeed(value);

    const min = Number(slider.min);
    const max = Number(slider.max);
    const progress = ((value - min) / (max - min)) * 100;
    slider.style.setProperty('--progress', `${progress}%`);
    presetButtons.forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.speed) === value);
    });
  }

  function save(speed) {
    const value = Number(speed);
    render(value);
    chrome.storage.sync.set({ [STORAGE_KEY]: value });
  }

  chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_SPEED }, (result) => {
    render(result[STORAGE_KEY]);
  });

  slider.addEventListener('input', () => save(slider.value));
  presetButtons.forEach((button) => {
    button.addEventListener('click', () => save(button.dataset.speed));
  });
})();
