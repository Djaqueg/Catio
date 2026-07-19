import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import { deserializeHexes, gameTick, updateCatBehaviors } from './cats.js';
import { findExpandablePositions } from './hex.js';
import { autoSave } from './save.js';
import { AUTO_SAVE_INTERVAL } from './config.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new Renderer(this.canvas);
    this.ui = new UI(this);
    this.state = null;
    this._loopId = null;
    this._tickId = null;
    this._autoSaveId = null;
    this._lastFrame = 0;

    this.renderer.onHexClick = (key) => this.ui.handleHexClick(key);

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

    const hexes = deserializeHexes(state.hexes);
    updateCatBehaviors(state.cats, hexes);
    this.renderer.centerOnHexes(hexes);
    this.updateExpandable();
    this.ui.updateHUD(state);

    this._lastFrame = performance.now();
    this._loopId = requestAnimationFrame((t) => this._renderLoop(t));

    clearInterval(this._tickId);
    this._tickId = setInterval(() => {
      if (!this.state) return;
      gameTick(this.state);
      this.ui.updateHUD(this.state);
    }, 2000);

    clearInterval(this._autoSaveId);
    this._autoSaveId = setInterval(() => {
      if (this.state) autoSave(this.state);
    }, AUTO_SAVE_INTERVAL);
  }

  stop() {
    cancelAnimationFrame(this._loopId);
    clearInterval(this._tickId);
    clearInterval(this._autoSaveId);
    this.state = null;
  }

  _normalizeState(state) {
    state.tilesPurchased = state.tilesPurchased ?? 0;
    state.selectedBuild = state.selectedBuild ?? null;
    state.lastCatArrival = state.lastCatArrival ?? Date.now();
    if (!state.cats) state.cats = [];
    if (!state.hexes) state.hexes = {};
    return state;
  }

  updateExpandable() {
    if (!this.state) return;
    const hexes = deserializeHexes(this.state.hexes);
    this.renderer.expandableKeys = findExpandablePositions(hexes);
  }

  _renderLoop(timestamp) {
    if (!this.state) return;
    this._loopId = requestAnimationFrame((t) => this._renderLoop(t));

    const hexes = deserializeHexes(this.state.hexes);
    this.renderer.draw(this.state, hexes, this.state.cats);
  }
}

new Game();
