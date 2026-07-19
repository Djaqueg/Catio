import {
  DIFFICULTIES, BUILDINGS, BUILDING_CATEGORIES, NEED_LABELS, NEEDS,
  AUTO_SAVE_INTERVAL, HAPPINESS_WARNING_THRESHOLD,
} from './config.js';
import {
  createNewGame, deserializeHexes, calcCatLimit, getAverageHappiness,
  hasLowHappinessWarning, getLowHappinessCats, placeBuilding, tryUpgrade,
  getTileCost, canPlaceBuilding, gameTick, isNameTaken,
} from './cats.js';
import { findExpandablePositions } from './hex.js';
import { loadAllSaves, saveGame, deleteSave, autoSave, getSaveMeta } from './save.js';
import { audio } from './audio.js';

export class UI {
  constructor(game) {
    this.game = game;
    this.pendingSlot = null;
    this.selectedDifficulty = 'normal';
    this._toastTimer = null;
    this._bindElements();
    this._bindEvents();
    this.syncMuteButton();
    this.renderMenu();
  }

  _bindElements() {
    this.el = {
      menuScreen: document.getElementById('menu-screen'),
      gameScreen: document.getElementById('game-screen'),
      saveSlots: document.getElementById('save-slots'),
      newGameModal: document.getElementById('new-game-modal'),
      catioName: document.getElementById('catio-name'),
      difficultyOptions: document.getElementById('difficulty-options'),
      croquetas: document.getElementById('croquetas-value'),
      happiness: document.getElementById('happiness-value'),
      statHappiness: document.getElementById('stat-happiness'),
      cats: document.getElementById('cats-value'),
      statCats: document.getElementById('stat-cats'),
      buildCategories: document.getElementById('build-categories'),
      buildDesc: document.getElementById('build-desc'),
      buildCost: document.getElementById('build-cost'),
      happinessPanel: document.getElementById('happiness-panel'),
      happinessDetail: document.getElementById('happiness-detail'),
      catsPanel: document.getElementById('cats-panel'),
      catsLimitDetail: document.getElementById('cats-limit-detail'),
      pausePanel: document.getElementById('pause-panel'),
      toast: document.getElementById('toast'),
      muteBtn: document.getElementById('btn-mute'),
    };
  }

  _bindEvents() {
    document.getElementById('cancel-new-game').addEventListener('click', () => {
      audio.uiClick();
      this.el.newGameModal.classList.add('hidden');
    });

    document.getElementById('start-new-game').addEventListener('click', () => {
      const name = this.el.catioName.value.trim() || 'Mi Catio';
      if (this.pendingSlot !== null) {
        const state = createNewGame(this.pendingSlot, name, this.selectedDifficulty);
        saveGame(state);
        this.el.newGameModal.classList.add('hidden');
        audio.happyChime();
        this.game.start(state);
      }
    });

    this.el.statHappiness.addEventListener('click', () => {
      audio.uiClick();
      this.renderHappinessPanel();
      this.togglePanel('happiness-panel');
    });

    this.el.statCats.addEventListener('click', () => {
      audio.uiClick();
      this.renderCatsLimitPanel();
      this.togglePanel('cats-panel');
    });

    document.getElementById('btn-pause').addEventListener('click', () => {
      audio.uiClick();
      this.togglePanel('pause-panel');
    });

    this.el.muteBtn?.addEventListener('click', async () => {
      await audio.unlock();
      audio.toggle();
      this.syncMuteButton();
      if (audio.enabled) audio.uiClick();
    });

    document.getElementById('btn-save').addEventListener('click', () => {
      if (this.game.state) {
        saveGame(this.game.state);
        audio.uiClick();
        this.showToast('Partida guardada ✓');
      }
    });

    document.getElementById('btn-menu').addEventListener('click', () => {
      if (this.game.state) autoSave(this.game.state);
      audio.uiClick();
      this.game.stop();
      this.closeAllPanels();
      this.showScreen('menu');
      this.renderMenu();
    });

    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        audio.uiClick();
        this.closePanel(btn.dataset.close);
      });
    });
  }

  syncMuteButton() {
    if (!this.el.muteBtn) return;
    this.el.muteBtn.textContent = audio.enabled ? '🔊' : '🔇';
    this.el.muteBtn.title = audio.enabled ? 'Silenciar' : 'Activar sonido';
    this.el.muteBtn.setAttribute('aria-pressed', audio.enabled ? 'false' : 'true');
  }

  showScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(`${name}-screen`).classList.add('active');
  }

  togglePanel(id) {
    const panel = document.getElementById(id);
    const isOpen = !panel.classList.contains('hidden');
    this.closeAllPanels();
    if (!isOpen) panel.classList.remove('hidden');
  }

  closePanel(id) {
    document.getElementById(id).classList.add('hidden');
  }

  closeAllPanels() {
    document.querySelectorAll('.side-panel').forEach((p) => p.classList.add('hidden'));
  }

  showToast(msg) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.el.toast.classList.add('hidden'), 2200);
  }

  renderMenu() {
    const saves = loadAllSaves();
    this.el.saveSlots.innerHTML = '';

    saves.forEach((save, i) => {
      const meta = getSaveMeta(save);
      const slot = document.createElement('button');
      slot.className = `save-slot${meta ? '' : ' empty'}`;
      slot.type = 'button';

      if (meta) {
        const diff = DIFFICULTIES[meta.difficulty];
        slot.innerHTML = `
          <div class="slot-title">${meta.catioName}</div>
          <div class="slot-meta">🐾 ${meta.cats} gatos · 🍪 ${meta.croquetas} · ⬡ ${meta.tiles} casillas</div>
          <span class="slot-difficulty diff-${meta.difficulty}">${diff?.label || meta.difficulty}</span>
        `;
        slot.addEventListener('click', () => {
          this.game.start(save);
        });
      } else {
        slot.innerHTML = `
          <div class="slot-title">Partida ${i + 1}</div>
          <div class="slot-meta">Vacía — toca para crear</div>
        `;
        slot.addEventListener('click', () => this.openNewGameModal(i));
      }

      this.el.saveSlots.appendChild(slot);
    });
  }

  openNewGameModal(slot) {
    this.pendingSlot = slot;
    this.el.catioName.value = '';
    this.selectedDifficulty = 'normal';
    this.renderDifficultyOptions();
    this.el.newGameModal.classList.remove('hidden');
  }

  renderDifficultyOptions() {
    this.el.difficultyOptions.innerHTML = '';
    Object.values(DIFFICULTIES).forEach((d) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `diff-option${d.id === this.selectedDifficulty ? ' selected' : ''}`;
      btn.innerHTML = `<strong>${d.name}</strong><small>${d.description}</small>`;
      btn.addEventListener('click', () => {
        this.selectedDifficulty = d.id;
        this.renderDifficultyOptions();
      });
      this.el.difficultyOptions.appendChild(btn);
    });
  }

  renderBuildMenu(state) {
    this.el.buildCategories.innerHTML = '';

    BUILDING_CATEGORIES.forEach((cat) => {
      const items = Object.values(BUILDINGS).filter((b) => b.category === cat.id);
      if (items.length === 0) return;

      const group = document.createElement('div');
      group.className = 'category-group';
      group.innerHTML = `<div class="category-label">${cat.label}</div>`;

      const itemsRow = document.createElement('div');
      itemsRow.className = 'build-items';

      items.forEach((b) => {
        const id = b.id;
        const cost = id === 'hex_tile' ? getTileCost(state) : b.cost;
        const canAfford = state.croquetas >= cost;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `build-item${state.selectedBuild === id ? ' active' : ''}${canAfford ? '' : ' disabled'}`;
        btn.dataset.buildId = id;
        btn.innerHTML = `
          <span class="item-icon">${b.icon}</span>
          <span class="item-cost">${cost}🍪</span>
          <span class="item-name">${b.name}</span>
        `;
        btn.addEventListener('click', () => {
          state.selectedBuild = state.selectedBuild === id ? null : id;
          this.updateBuildInfo(state);
          this.renderBuildMenu(state);
          this.game.renderer.selectedBuild = state.selectedBuild;
          this.game.updateExpandable();
        });
        itemsRow.appendChild(btn);
      });

      group.appendChild(itemsRow);
      this.el.buildCategories.appendChild(group);
    });
  }

  updateBuildInfo(state) {
    const id = state.selectedBuild;
    if (!id) {
      this.el.buildDesc.textContent = 'Selecciona un elemento para construir';
      this.el.buildDesc.classList.remove('selected');
      this.el.buildCost.textContent = '';
      return;
    }

    let b = BUILDINGS[id];
    if (id === 'hex_tile') {
      b = { ...BUILDINGS.hex_tile, cost: getTileCost(state) };
    }
    this.el.buildDesc.textContent = b.description || '';
    this.el.buildDesc.classList.add('selected');
    this.el.buildCost.textContent = `Costo: ${b.cost} croquetas`;
  }

  updateHUD(state) {
    const hexes = deserializeHexes(state.hexes);
    const avg = getAverageHappiness(state.cats);
    const limit = calcCatLimit(hexes);
    const warn = hasLowHappinessWarning(state.cats);

    this.el.croquetas.textContent = Math.floor(state.croquetas);
    this.el.happiness.textContent = `${avg}%`;
    this.el.cats.textContent = `${state.cats.length}/${limit.total}`;

    this.el.statHappiness.classList.toggle('warning', warn);

    this.renderBuildMenu(state);
    this.updateBuildInfo(state);
  }

  renderHappinessPanel() {
    const state = this.game.state;
    if (!state) return;

    const avg = getAverageHappiness(state.cats);
    const lowCats = getLowHappinessCats(state.cats);

    let html = `
      <div class="avg-box">
        <div class="avg-value">${avg}%</div>
        <div class="avg-label">Felicidad promedio</div>
      </div>
    `;

    if (lowCats.length > 0) {
      html += `
        <div class="warn-banner">
          ⚠️ ${lowCats.map((c) => c.name).join(', ')} ${lowCats.length === 1 ? 'está' : 'están'}
          por debajo del ${HAPPINESS_WARNING_THRESHOLD}%. Revisa alimento, camas, areneros y más.
        </div>
      `;
    }

    state.cats.forEach((cat) => {
      const barClass = cat.happiness >= 60 ? 'bar-good' : cat.happiness >= 35 ? 'bar-ok' : 'bar-low';
      const needsHtml = NEEDS.map((n) => {
        const v = Math.round(cat.needs[n]);
        return `<span class="need-tag">${NEED_LABELS[n]} ${v}%</span>`;
      }).join('');

      html += `
        <div class="cat-happiness-row">
          <span class="cat-avatar">${cat.mood}</span>
          <div class="cat-info">
            <div class="cat-name">${cat.name} — ${cat.happiness}%</div>
            <div class="cat-activity">${cat.activityLabel || 'Explorando el catio'}</div>
            <div class="cat-bar-wrap"><div class="cat-bar ${barClass}" style="width:${cat.happiness}%"></div></div>
            <div class="needs-mini">${needsHtml}</div>
          </div>
        </div>
      `;
    });

    this.el.happinessDetail.innerHTML = html;
  }

  renderCatsLimitPanel() {
    const state = this.game.state;
    if (!state) return;

    const hexes = deserializeHexes(state.hexes);
    const limit = calcCatLimit(hexes);

    let rows = `
      <div class="limit-row"><span>Base del catio</span><span>+${limit.base}</span></div>
    `;

    limit.breakdown.forEach((item) => {
      rows += `<div class="limit-row"><span>${item.source}</span><span>+${item.amount}</span></div>`;
    });

    this.el.catsLimitDetail.innerHTML = `
      <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.75rem">
        El límite depende de camas, refugios y el espacio disponible en tu catio.
      </p>
      <div class="limit-formula">
        ${rows}
        <div class="total">= ${limit.total} gatos máximo</div>
      </div>
      <p style="font-size:0.82rem;color:var(--text-muted)">
        Actualmente tienes <strong style="color:var(--accent-gold)">${state.cats.length}</strong> gatos.
        ${state.cats.length >= limit.total ? ' ¡Has alcanzado el límite! Construye más camas o expande el catio.' : ''}
      </p>
    `;
  }

  handleHexClick(hexKey) {
    const state = this.game.state;
    if (!state) return;

    const hexes = deserializeHexes(state.hexes);
    const hex = hexes.get(hexKey);

    if (!state.selectedBuild) {
      if (hex?.building) {
        const b = BUILDINGS[hex.building];
        if (b?.upgradeable) {
          const result = tryUpgrade(state, hexKey);
          if (result.ok) {
            audio.upgrade();
            this.showToast(`${b.name} mejorado a nivel ${result.newLevel}!`);
            saveGame(state);
          } else {
            audio.uiClick();
            this.showToast(result.reason);
          }
        } else {
          audio.uiClick();
          this.showToast(b?.description || 'Edificio construido');
        }
      }
      return;
    }

    if (!canPlaceBuilding(state, hexKey, state.selectedBuild)) {
      audio.uiClick();
      this.showToast('No se puede construir aquí');
      return;
    }

    const result = placeBuilding(state, hexKey, state.selectedBuild);
    if (result.ok) {
      audio.place();
      this.showToast('¡Construido!');
      if (state.selectedBuild !== 'hex_tile') {
        state.selectedBuild = null;
        this.game.renderer.selectedBuild = null;
      }
      this.game.updateExpandable();
      this.game.renderer.centerOnHexes(deserializeHexes(state.hexes));
      saveGame(state);
    } else {
      audio.uiClick();
      this.showToast(result.reason);
    }
  }
}
