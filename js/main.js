import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import { deserializeHexes, gameTick, updateCatBehaviors, updateCatMovement } from './cats.js';
import { findExpandablePositions } from './hex.js';
import { autoSave } from './save.js';
import { AUTO_SAVE_INTERVAL } from './config.js';
import { audio } from './audio.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new Renderer(this.canvas);
    this.ui = new UI(this);
    this.audio = audio;
    this.state = null;
    this._loopId = null;
    this._tickId = null;
    this._behaviorId = null;
    this._autoSaveId = null;
    this._lastFrame = 0;
    this._lastCatHex = new Map();

    this.renderer.onHexClick = (key) => this.ui.handleHexClick(key);

    // Unlock audio on first interaction
    const unlock = () => {
      audio.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    window.addEventListener('resize', () => {
      this.renderer.resize();
      if (this.state) {
        this.renderer.centerOnHexes(deserializeHexes(this.state.hexes));
      }
    });

    this.renderer.resize();
  }

  start(state) {
    this.state = this._normalizeState(state);
    this.ui.showScreen('game');
    this.ui.closeAllPanels();
    this.renderer.resize();
    this.ui.syncMuteButton();

    const hexes = deserializeHexes(state.hexes);
    updateCatBehaviors(state.cats, hexes);
    updateCatMovement(state.cats, hexes);
    this._lastCatHex = new Map(state.cats.map((c) => [c.id, c.hexKey]));
    this.renderer.centerOnHexes(hexes);
    this.updateExpandable();
    this.ui.updateHUD(state);

    audio.startGameAudio();

    this._lastFrame = performance.now();
    this._loopId = requestAnimationFrame((t) => this._renderLoop(t));

    clearInterval(this._tickId);
    this._tickId = setInterval(() => {
      if (!this.state) return;
      gameTick(this.state);
      this.ui.updateHUD(this.state);
    }, 2000);

    // Behaviors + step movement more often so cats keep walking
    clearInterval(this._behaviorId);
    this._behaviorId = setInterval(() => {
      if (!this.state) return;
      const hexesNow = deserializeHexes(this.state.hexes);
      updateCatBehaviors(this.state.cats, hexesNow);
      updateCatMovement(this.state.cats, hexesNow);
      this._playCatMotionSounds();
    }, 450);

    clearInterval(this._autoSaveId);
    this._autoSaveId = setInterval(() => {
      if (this.state) autoSave(this.state);
    }, AUTO_SAVE_INTERVAL);
  }

  stop() {
    cancelAnimationFrame(this._loopId);
    clearInterval(this._tickId);
    clearInterval(this._behaviorId);
    clearInterval(this._autoSaveId);
    audio.stopGameAudio();
    this.state = null;
  }

  _normalizeState(state) {
    state.tilesPurchased = state.tilesPurchased ?? 0;
    state.selectedBuild = state.selectedBuild ?? null;
    state.lastCatArrival = state.lastCatArrival ?? Date.now();
    if (!state.cats) state.cats = [];
    if (!state.hexes) state.hexes = {};
    state.cats.forEach((cat) => {
      cat.goalKey = cat.goalKey ?? null;
      cat.pendingActivity = cat.pendingActivity ?? null;
      cat.nextStepAt = cat.nextStepAt ?? 0;
      cat.gestureCooldown = cat.gestureCooldown ?? 0;
    });
    return state;
  }

  updateExpandable() {
    if (!this.state) return;
    const hexes = deserializeHexes(this.state.hexes);
    this.renderer.expandableKeys = findExpandablePositions(hexes);
  }

  _playCatMotionSounds() {
    if (!this.state) return;
    let stepped = false;
    this.state.cats.forEach((cat) => {
      const prev = this._lastCatHex.get(cat.id);
      if (prev && prev !== cat.hexKey) stepped = true;
      this._lastCatHex.set(cat.id, cat.hexKey);

      if (cat.activity === 'yawn' || cat.activity === 'meow') {
        /* occasional meow handled by ambient scheduler */
      }
      if (cat.activity === 'loaf' || cat.activity === 'sleep') {
        if (Math.random() < 0.04) audio.purr();
      }
      if (cat.activity === 'pounce' && Math.random() < 0.12) audio.meow();
    });
    if (stepped) audio.softStep();
  }

  _renderLoop(timestamp) {
    if (!this.state) return;
    this._loopId = requestAnimationFrame((t) => this._renderLoop(t));

    const hexes = deserializeHexes(this.state.hexes);
    // Smooth continuous movement advancement
    updateCatMovement(this.state.cats, hexes);
    this.renderer.draw(this.state, hexes, this.state.cats);
  }
}

new Game();
