'use strict';

(() => {
  const DEFAULT_NAMES = ['Player 1', 'Player 2'];
  const DEFAULT_TARGET = 100;
  const TARGET_MIN = 20;
  const TARGET_MAX = 999;
  const HISTORY_LIMIT = 12;
  const STORAGE_KEY = 'pigGameSettings';
  const DICE_SIDES = 6;
  const RANDOM_RANGE = 0x100000000;
  const MAX_FAIR_RANDOM = RANDOM_RANGE - (RANDOM_RANGE % DICE_SIDES);
  const getCryptoRandomValues = window.crypto?.getRandomValues?.bind(
    window.crypto
  );
  const fallbackRandom = Math.random.bind(Math);

  const modal = document.getElementById('modal');
  const overlay = document.getElementById('overlay');
  const btnCloseModal = document.getElementById('closeModal');
  const btnRules = document.querySelector('.btn--rules');
  const mainEl = document.querySelector('main');
  const player0El = document.querySelector('.player--0');
  const player1El = document.querySelector('.player--1');
  const name0El = document.getElementById('name--0');
  const name1El = document.getElementById('name--1');
  const score0El = document.getElementById('score--0');
  const score1El = document.getElementById('score--1');
  const current0El = document.getElementById('current--0');
  const current1El = document.getElementById('current--1');
  const diceEl = document.querySelector('.dice');
  const btnNew = document.querySelector('.btn--new');
  const btnRoll = document.querySelector('.btn--roll');
  const btnHold = document.querySelector('.btn--hold');
  const btnSound = document.querySelector('.btn--sound');
  const soundIconEl = document.querySelector('.sound-icon');
  const targetRadios = [...document.querySelectorAll('input[name="target"]')];
  const targetCustomEl = document.getElementById('targetCustom');
  const historyListEl = document.getElementById('historyList');
  const btnClearLog = document.querySelector('.btn-clear-log');
  const playerEls = [player0El, player1El];
  const nameEls = [name0El, name1El];
  const scoreEls = [score0El, score1El];
  const currentEls = [current0El, current1El];
  const protectedEls = [
    player0El,
    player1El,
    score0El,
    score1El,
    current0El,
    current1El,
    diceEl,
    btnNew,
    btnRoll,
    btnHold,
  ];

  let state;
  let settings;
  let isRendering = false;
  let renderQueued = false;
  let historyId = 0;
  let audioContext = null;
  let lastFocusedElement = null;

  const clamp = function (value, min, max) {
    return Math.min(Math.max(value, min), max);
  };

  const cleanPlayerName = function (name, playerIndex) {
    const trimmedName = String(name || '').trim().slice(0, 18);
    return trimmedName || DEFAULT_NAMES[playerIndex];
  };

  const cleanTarget = function (target) {
    return clamp(Number.parseInt(target, 10) || DEFAULT_TARGET, TARGET_MIN, TARGET_MAX);
  };

  const loadSettings = function () {
    const fallbackSettings = {
      playerNames: [...DEFAULT_NAMES],
      targetMode: String(DEFAULT_TARGET),
      customTarget: DEFAULT_TARGET,
      soundEnabled: false,
    };

    try {
      const savedSettings = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!savedSettings || typeof savedSettings !== 'object') return fallbackSettings;

      const targetMode = ['50', '100', 'custom'].includes(savedSettings.targetMode)
        ? savedSettings.targetMode
        : String(DEFAULT_TARGET);

      return {
        playerNames: DEFAULT_NAMES.map((name, index) =>
          cleanPlayerName(savedSettings.playerNames?.[index] || name, index)
        ),
        targetMode,
        customTarget: cleanTarget(savedSettings.customTarget),
        soundEnabled: Boolean(savedSettings.soundEnabled),
      };
    } catch {
      return fallbackSettings;
    }
  };

  const saveSettings = function () {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore unavailable storage; the game should still run normally.
    }
  };

  const getTargetScore = function () {
    return settings.targetMode === 'custom'
      ? cleanTarget(settings.customTarget)
      : Number(settings.targetMode);
  };

  const getPlayerName = function (playerIndex) {
    return cleanPlayerName(settings.playerNames[playerIndex], playerIndex);
  };

  const createHistoryEntry = function (type, message) {
    historyId += 1;
    return Object.freeze({ id: historyId, type, message });
  };

  const sealState = function (nextState) {
    return Object.freeze({
      scores: Object.freeze([...nextState.scores]),
      currentScore: nextState.currentScore,
      activePlayer: nextState.activePlayer,
      playing: nextState.playing,
      dice: nextState.dice,
      winner: nextState.winner,
      targetScore: nextState.targetScore,
      history: Object.freeze([...(nextState.history || [])]),
    });
  };

  const withHistory = function (nextState, type, message) {
    return sealState({
      ...nextState,
      history: [
        createHistoryEntry(type, message),
        ...state.history,
      ].slice(0, HISTORY_LIMIT),
    });
  };

  const createInitialState = function (message) {
    return sealState({
      scores: [0, 0],
      currentScore: 0,
      activePlayer: 0,
      playing: true,
      dice: null,
      winner: null,
      targetScore: getTargetScore(),
      history: [createHistoryEntry('new', message)],
    });
  };

  const rollDie = function () {
    if (!getCryptoRandomValues) {
      return Math.trunc(fallbackRandom() * DICE_SIDES) + 1;
    }

    const randomValue = new Uint32Array(1);

    do {
      getCryptoRandomValues(randomValue);
    } while (randomValue[0] >= MAX_FAIR_RANDOM);

    return (randomValue[0] % DICE_SIDES) + 1;
  };

  const resetProtectedInlineStyles = function () {
    protectedEls.forEach(el => el.removeAttribute('style'));
  };

  const renderSettings = function () {
    nameEls.forEach((nameEl, playerIndex) => {
      if (document.activeElement !== nameEl) {
        nameEl.value = getPlayerName(playerIndex);
      }
    });

    targetRadios.forEach(radio => {
      radio.checked = radio.value === settings.targetMode;
    });

    targetCustomEl.disabled = settings.targetMode !== 'custom';
    targetCustomEl
      .closest('.custom-target')
      .classList.toggle('hidden', settings.targetMode !== 'custom');
    if (document.activeElement !== targetCustomEl) {
      targetCustomEl.value = settings.customTarget;
    }

    btnSound.setAttribute('aria-pressed', String(settings.soundEnabled));
    soundIconEl.textContent = settings.soundEnabled ? '🔊' : '🔇';
  };

  const renderHistory = function () {
    historyListEl.replaceChildren();

    state.history.forEach(entry => {
      const item = document.createElement('li');
      item.className = `history--${entry.type}`;
      item.textContent = entry.message;
      historyListEl.append(item);
    });
  };

  const render = function () {
    isRendering = true;
    resetProtectedInlineStyles();
    renderSettings();

    scoreEls.forEach((scoreEl, playerIndex) => {
      scoreEl.textContent = state.scores[playerIndex];
    });

    currentEls.forEach((currentEl, playerIndex) => {
      currentEl.textContent =
        state.playing && state.activePlayer === playerIndex
          ? state.currentScore
          : 0;
    });

    playerEls.forEach((playerEl, playerIndex) => {
      playerEl.classList.toggle(
        'player--active',
        state.playing && state.activePlayer === playerIndex
      );
      playerEl.classList.toggle('player--winner', state.winner === playerIndex);
    });

    diceEl.classList.toggle('hidden', state.dice === null);
    if (state.dice !== null) diceEl.src = `dice-${state.dice}.png`;

    btnRoll.disabled = !state.playing;
    btnHold.disabled = !state.playing;
    renderHistory();

    window.setTimeout(() => {
      isRendering = false;
    }, 0);
  };

  const queueRender = function () {
    if (isRendering || renderQueued) return;

    renderQueued = true;
    window.requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  };

  const restartAnimation = function (element, className) {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  };

  const getAudioContext = function () {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;

    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();
    return audioContext;
  };

  const playTone = function (frequency, duration, delay = 0, type = 'sine') {
    const context = getAudioContext();
    if (!context) return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startsAt = context.currentTime + delay;
    const endsAt = startsAt + duration;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startsAt);
    gain.gain.setValueAtTime(0.0001, startsAt);
    gain.gain.exponentialRampToValueAtTime(0.075, startsAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startsAt);
    oscillator.stop(endsAt + 0.02);
  };

  const playSound = function (soundName) {
    if (!settings.soundEnabled) return;

    if (soundName === 'roll') playTone(420, 0.08, 0, 'triangle');
    if (soundName === 'hold') playTone(660, 0.1, 0, 'sine');
    if (soundName === 'bust') {
      playTone(260, 0.09, 0, 'sawtooth');
      playTone(160, 0.12, 0.08, 'sawtooth');
    }
    if (soundName === 'win') {
      playTone(520, 0.09, 0, 'triangle');
      playTone(660, 0.09, 0.1, 'triangle');
      playTone(820, 0.14, 0.2, 'triangle');
    }
  };

  const startNewGame = function (message = `New game to ${getTargetScore()} points.`) {
    state = createInitialState(message);
    render();
  };

  const roll = function () {
    if (!state.playing) return;

    const activePlayer = state.activePlayer;
    const activeName = getPlayerName(activePlayer);
    const dice = rollDie();

    if (dice !== 1) {
      const nextCurrentScore = state.currentScore + dice;
      state = withHistory(
        { ...state, dice, currentScore: nextCurrentScore },
        'roll',
        `${activeName} rolled ${dice}. Current: ${nextCurrentScore}.`
      );
      playSound('roll');
      render();
      restartAnimation(playerEls[activePlayer], 'player--pulse');
    } else {
      state = withHistory(
        {
          ...state,
          dice,
          currentScore: 0,
          activePlayer: activePlayer === 0 ? 1 : 0,
        },
        'bust',
        `${activeName} rolled 1 and lost the turn.`
      );
      playSound('bust');
      render();
      restartAnimation(playerEls[activePlayer], 'player--bust');
    }

    restartAnimation(diceEl, 'dice--rolling');
  };

  const hold = function () {
    if (!state.playing) return;

    const activePlayer = state.activePlayer;
    const activeName = getPlayerName(activePlayer);
    const nextScores = [...state.scores];
    nextScores[activePlayer] += state.currentScore;

    if (nextScores[activePlayer] >= state.targetScore) {
      state = withHistory(
        {
          ...state,
          scores: nextScores,
          currentScore: 0,
          playing: false,
          dice: null,
          winner: activePlayer,
        },
        'win',
        `${activeName} held ${state.currentScore} and won with ${nextScores[activePlayer]}.`
      );
      playSound('win');
      render();
      restartAnimation(playerEls[activePlayer], 'player--pulse');
      return;
    }

    state = withHistory(
      {
        ...state,
        scores: nextScores,
        currentScore: 0,
        activePlayer: activePlayer === 0 ? 1 : 0,
      },
      'hold',
      `${activeName} held ${state.currentScore}. Total: ${nextScores[activePlayer]}.`
    );
    playSound('hold');
    render();
    restartAnimation(playerEls[activePlayer], 'player--pulse');
  };

  const clearHistory = function () {
    state = sealState({ ...state, history: [] });
    render();
  };

  const applyTargetMode = function (targetMode) {
    settings.targetMode = targetMode;
    if (targetMode === 'custom') {
      settings.customTarget = cleanTarget(targetCustomEl.value);
    }
    saveSettings();
    startNewGame(`Target set to ${getTargetScore()} points.`);
  };

  const applyCustomTarget = function () {
    settings.targetMode = 'custom';
    settings.customTarget = cleanTarget(targetCustomEl.value);
    saveSettings();
    startNewGame(`Target set to ${settings.customTarget} points.`);
  };

  const isEditableTarget = function (element) {
    return (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element.isContentEditable
    );
  };

  const getModalFocusableEls = function () {
    return [
      ...modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ),
    ].filter(el => !el.disabled && !el.classList.contains('hidden'));
  };

  const openModal = function () {
    lastFocusedElement = document.activeElement;
    modal.classList.remove('hidden');
    overlay.classList.remove('hidden');

    window.setTimeout(() => {
      const [firstFocusableEl] = getModalFocusableEls();
      (firstFocusableEl || modal).focus();
    }, 0);
  };

  const closeModal = function () {
    modal.classList.add('hidden');
    overlay.classList.add('hidden');

    if (
      lastFocusedElement &&
      document.contains(lastFocusedElement) &&
      lastFocusedElement !== document.body
    ) {
      lastFocusedElement.focus();
    }
  };

  const handleModalFocus = function (event) {
    if (modal.classList.contains('hidden') || event.key !== 'Tab') return;

    const focusableEls = getModalFocusableEls();
    if (focusableEls.length === 0) {
      event.preventDefault();
      modal.focus();
      return;
    }

    const firstFocusableEl = focusableEls[0];
    const lastFocusableEl = focusableEls[focusableEls.length - 1];

    if (event.shiftKey && document.activeElement === firstFocusableEl) {
      event.preventDefault();
      lastFocusableEl.focus();
    }

    if (!event.shiftKey && document.activeElement === lastFocusableEl) {
      event.preventDefault();
      firstFocusableEl.focus();
    }
  };

  const handleKeyboard = function (event) {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
      return;
    }

    handleModalFocus(event);

    if (!modal.classList.contains('hidden') || isEditableTarget(event.target)) return;
    const key = event.key.toLowerCase();

    if (key === 'r') {
      event.preventDefault();
      roll();
    }

    if (key === 'h') {
      event.preventDefault();
      hold();
    }

    if (key === 'n') {
      event.preventDefault();
      startNewGame();
    }
  };

  nameEls.forEach((nameEl, playerIndex) => {
    nameEl.addEventListener('input', function () {
      settings.playerNames[playerIndex] = nameEl.value.slice(0, 18);
      saveSettings();
    });

    nameEl.addEventListener('blur', function () {
      settings.playerNames[playerIndex] = cleanPlayerName(nameEl.value, playerIndex);
      saveSettings();
      renderSettings();
    });
  });

  targetRadios.forEach(radio => {
    radio.addEventListener('change', function () {
      if (!radio.checked) return;
      applyTargetMode(radio.value);
      if (radio.value === 'custom') targetCustomEl.focus();
    });
  });

  targetCustomEl.addEventListener('change', applyCustomTarget);

  btnCloseModal.addEventListener('click', closeModal);
  btnRules.addEventListener('click', openModal);
  overlay.addEventListener('click', closeModal);
  document.addEventListener('keydown', handleKeyboard);

  btnRoll.addEventListener('click', roll);
  btnHold.addEventListener('click', hold);
  btnNew.addEventListener('click', function () {
    startNewGame();
  });
  btnClearLog.addEventListener('click', clearHistory);
  btnSound.addEventListener('click', function () {
    settings.soundEnabled = !settings.soundEnabled;
    saveSettings();
    renderSettings();
    playSound('hold');
  });

  diceEl.addEventListener('animationend', function () {
    diceEl.classList.remove('dice--rolling');
  });

  playerEls.forEach(playerEl => {
    playerEl.addEventListener('animationend', function () {
      playerEl.classList.remove('player--pulse', 'player--bust');
    });
  });

  const domRepairObserver = new MutationObserver(queueRender);
  domRepairObserver.observe(mainEl, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  settings = loadSettings();
  startNewGame();
  openModal();
})();
