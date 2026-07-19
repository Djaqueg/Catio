import { DIFFICULTIES, NEEDS, CAT_NAMES, BUILDINGS, BASE_CAT_LIMIT, HAPPINESS_WARNING_THRESHOLD, TILE_BASE_COST, TILE_COST_INCREMENT } from './config.js';
import { generateInitialHexes, axialKey, hexNeighbors, parseKey, findExpandablePositions, getTilesInRange, hexDistance } from './hex.js';

let namePool = [...CAT_NAMES];

export function resetNamePool(usedNames = []) {
  const used = new Set(usedNames.map((n) => n.toLowerCase()));
  namePool = CAT_NAMES.filter((n) => !used.has(n.toLowerCase()));
}

export function generateCatName(existingNames) {
  const used = new Set(existingNames.map((n) => n.toLowerCase()));
  const available = namePool.filter((n) => !used.has(n.toLowerCase()));
  if (available.length === 0) {
    let i = 1;
    while (used.has(`gato ${i}`)) i++;
    return `Gato ${i}`;
  }
  const idx = Math.floor(Math.random() * available.length);
  return available[idx];
}

export function isNameTaken(name, cats, excludeId = null) {
  const lower = name.trim().toLowerCase();
  if (!lower) return true;
  return cats.some((c) => c.id !== excludeId && c.name.toLowerCase() === lower);
}

export function createCat(name, hexKey) {
  const needs = {};
  NEEDS.forEach((n) => { needs[n] = 65 + Math.random() * 25; });
  const coats = [
    { coat: '#f0c4a0', dark: '#d49a72', light: '#fff0dc', pattern: 'tabby', eyes: '#8ecf7a', blush: '#f5a8b0' },
    { coat: '#f2ebe3', dark: '#c4b8b0', light: '#fffaf4', pattern: 'patches', eyes: '#7ec4d4', blush: '#f2b0b8' },
    { coat: '#c8c0d0', dark: '#9a90a4', light: '#ebe4f0', pattern: 'solid', eyes: '#e8c86a', blush: '#e8a8b0' },
    { coat: '#e8b898', dark: '#c88868', light: '#fce8d4', pattern: 'tuxedo', eyes: '#9ad070', blush: '#f0a8a8' },
    { coat: '#e8d8c8', dark: '#b8a898', light: '#faf4ec', pattern: 'points', eyes: '#78b8d8', blush: '#f0b0b8' },
    { coat: '#f0c8d0', dark: '#d898a8', light: '#fff0f4', pattern: 'solid', eyes: '#90c8e0', blush: '#f8a0b0' },
  ];
  const appearance = { ...coats[Math.floor(Math.random() * coats.length)] };
  return {
    id: `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    hexKey,
    needs,
    happiness: 85,
    mood: '😸',
    appearance,
    activity: 'explore',
    activityLabel: 'Explorando',
    behaviorUntil: 0,
    goalKey: null,
    pendingActivity: null,
    nextStepAt: 0,
    gestureCooldown: 0,
  };
}

export function calcCatHappiness(cat) {
  const values = NEEDS.map((n) => cat.needs[n] ?? 0);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  cat.happiness = Math.round(avg);
  if (cat.happiness >= 75) cat.mood = '😸';
  else if (cat.happiness >= 50) cat.mood = '😐';
  else if (cat.happiness >= 30) cat.mood = '😿';
  else cat.mood = '😾';
  return cat.happiness;
}

export function decayCatNeeds(cat, decayRate) {
  NEEDS.forEach((n) => {
    cat.needs[n] = Math.max(0, cat.needs[n] - decayRate * (0.8 + Math.random() * 0.4));
  });
  calcCatHappiness(cat);
}

export function getAverageHappiness(cats) {
  if (cats.length === 0) return 100;
  return Math.round(cats.reduce((s, c) => s + c.happiness, 0) / cats.length);
}

export function hasLowHappinessWarning(cats) {
  return cats.some((c) => c.happiness < HAPPINESS_WARNING_THRESHOLD);
}

export function getLowHappinessCats(cats) {
  return cats.filter((c) => c.happiness < HAPPINESS_WARNING_THRESHOLD);
}

export function calcCatLimit(hexes) {
  let fromBeds = 0;
  let fromTiles = 0;
  const breakdown = [];

  hexes.forEach((hex) => {
    if (!hex.building) return;
    const b = BUILDINGS[hex.building];
    if (!b) return;
    if (b.catCapacity) {
      const cap = b.catCapacity * (hex.level || 1);
      fromBeds += cap;
      breakdown.push({ source: b.name, amount: cap, type: 'bed' });
    }
  });

  const ownedCount = hexes.size;
  fromTiles = Math.floor(ownedCount / 4);
  if (fromTiles > 0) {
    breakdown.push({ source: `Espacio (${ownedCount} casillas ÷ 4)`, amount: fromTiles, type: 'space' });
  }

  const total = BASE_CAT_LIMIT + fromBeds + fromTiles;
  return { total, base: BASE_CAT_LIMIT, fromBeds, fromTiles, breakdown, ownedCount };
}

export function applyBuildingEffects(hexes, cats) {
  const supply = {};
  NEEDS.forEach((n) => { supply[n] = 0; });

  hexes.forEach((hex) => {
    if (!hex.building || hex.building === 'hex_tile') return;
    const b = BUILDINGS[hex.building];
    if (!b || !b.provides) return;
    const level = hex.level || 1;
    Object.entries(b.provides).forEach(([need, val]) => {
      supply[need] = (supply[need] || 0) + val * level;
    });
    if (b.upgradeable && level > 1 && b.upgradeBonus) {
      Object.entries(b.upgradeBonus).forEach(([need, val]) => {
        supply[need] = (supply[need] || 0) + val * (level - 1);
      });
    }
  });

  cats.forEach((cat) => {
    const localSupply = getLocalSupplyForCat(cat.hexKey, hexes);
    NEEDS.forEach((need) => {
      const total = (supply[need] || 0) + (localSupply[need] || 0);
      const demand = cats.length;
      const ratio = demand > 0 ? total / demand : 1;
      const boost = Math.min(100, cat.needs[need] + ratio * 2.5);
      cat.needs[need] = Math.max(0, Math.min(100, boost));
    });
    calcCatHappiness(cat);
  });
}

function getLocalSupplyForCat(catHexKey, hexes) {
  const local = {};
  NEEDS.forEach((n) => { local[n] = 0; });
  if (!hexes.has(catHexKey)) return local;

  const nearby = getTilesInRange(catHexKey, hexes, 1);
  nearby.forEach((key) => {
    const hex = hexes.get(key);
    if (!hex?.building) return;
    const b = BUILDINGS[hex.building];
    if (!b?.provides) return;
    const level = hex.level || 1;
    Object.entries(b.provides).forEach(([need, val]) => {
      local[need] = (local[need] || 0) + val * 0.5 * level;
    });
  });
  return local;
}

export function assignCatPositions(cats, hexes) {
  const keys = [...hexes.keys()];
  cats.forEach((cat) => {
    if (!cat.hexKey || !hexes.has(cat.hexKey)) {
      cat.hexKey = keys[Math.floor(Math.random() * keys.length)];
    }
  });
}

const ACTIVITY_BY_NEED = {
  food: { activity: 'eat', label: 'Comiendo' },
  sleep: { activity: 'sleep', label: 'Durmiendo' },
  fun: { activity: 'play', label: 'Jugando' },
  health: { activity: 'drink', label: 'Bebiendo' },
  warmth: { activity: 'warm', label: 'Tomando calor' },
  hygiene: { activity: 'litter', label: 'Usando el arenero' },
};

const GESTURES = [
  { activity: 'stretch', label: 'Estirándose', duration: [2200, 3200] },
  { activity: 'yawn', label: 'Bostezando', duration: [1800, 2800] },
  { activity: 'lick', label: 'Lamiéndose la pata', duration: [2500, 4000] },
  { activity: 'loaf', label: 'Haciendo panecillo', duration: [3500, 5500] },
  { activity: 'ear_twitch', label: 'Orejas alerta', duration: [1400, 2200] },
  { activity: 'tail_flick', label: 'Moviendo la cola', duration: [1600, 2600] },
  { activity: 'pounce', label: 'Saltando a jugar', duration: [1800, 2800] },
  { activity: 'groom', label: 'Aseándose', duration: [2800, 4200] },
  { activity: 'watch', label: 'Observando', duration: [2500, 4000] },
  { activity: 'roll', label: 'Revolcándose', duration: [2200, 3400] },
];

function randomRange([min, max]) {
  return min + Math.random() * (max - min);
}

function nextStepToward(fromKey, toKey, hexes) {
  if (!fromKey || fromKey === toKey) return toKey;
  const from = parseKey(fromKey);
  const to = parseKey(toKey);
  const neighbors = hexNeighbors(from.q, from.r)
    .map((n) => axialKey(n.q, n.r))
    .filter((key) => hexes.has(key));
  if (!neighbors.length) return fromKey;
  neighbors.sort((a, b) => {
    const pa = parseKey(a);
    const pb = parseKey(b);
    return hexDistance(pa, to) - hexDistance(pb, to);
  });
  return neighbors[0];
}

function pickWanderTarget(fromKey, hexes, allKeys) {
  const from = parseKey(fromKey || allKeys[0]);
  const nearby = hexNeighbors(from.q, from.r)
    .map((n) => axialKey(n.q, n.r))
    .filter((key) => hexes.has(key) && key !== fromKey);
  if (nearby.length) return nearby[Math.floor(Math.random() * nearby.length)];
  const others = allKeys.filter((key) => key !== fromKey);
  if (others.length) return others[Math.floor(Math.random() * others.length)];
  return fromKey;
}

function ensureCatMotionFields(cat) {
  if (!cat.goalKey) cat.goalKey = null;
  if (!cat.pendingActivity) cat.pendingActivity = null;
  if (cat.nextStepAt == null) cat.nextStepAt = 0;
  if (cat.gestureCooldown == null) cat.gestureCooldown = 0;
}

/** Avanza el caminar casilla a casilla (llamar ~cada frame o a menudo). */
export function updateCatMovement(cats, hexes, now = Date.now()) {
  if (!hexes.size) return;
  cats.forEach((cat) => {
    ensureCatMotionFields(cat);
    if (!cat.hexKey || !hexes.has(cat.hexKey)) {
      cat.hexKey = [...hexes.keys()][0];
    }

    // Todavía en una actividad in-place
    if ((cat.behaviorUntil || 0) > now && !cat.goalKey) {
      const need = Object.entries(ACTIVITY_BY_NEED)
        .find(([, value]) => value.activity === cat.activity)?.[0];
      if (need && cat.needs[need] !== undefined) {
        cat.needs[need] = Math.min(100, cat.needs[need] + 0.12);
      }
      return;
    }

    // Caminando hacia un objetivo
    if (cat.goalKey && hexes.has(cat.goalKey)) {
      if (cat.hexKey === cat.goalKey) {
        const pending = cat.pendingActivity;
        cat.goalKey = null;
        cat.pendingActivity = null;
        if (pending) {
          cat.activity = pending.activity;
          cat.activityLabel = pending.label;
          cat.behaviorUntil = now + pending.duration;
        } else {
          cat.activity = 'explore';
          cat.activityLabel = 'Explorando';
          cat.behaviorUntil = now + 800;
        }
        return;
      }

      if ((cat.nextStepAt || 0) > now) {
        cat.activity = 'walk';
        cat.activityLabel = 'Caminando';
        return;
      }

      const step = nextStepToward(cat.hexKey, cat.goalKey, hexes);
      if (step === cat.hexKey) {
        cat.goalKey = null;
        return;
      }
      cat.hexKey = step;
      cat.activity = 'walk';
      cat.activityLabel = 'Caminando';
      cat.nextStepAt = now + 380 + Math.random() * 180;
      return;
    }

    cat.goalKey = null;
  });
}

/** Elige nuevos destinos / gestos cuando el gato está libre. */
export function updateCatBehaviors(cats, hexes) {
  if (!hexes.size) return;
  const now = Date.now();
  const allKeys = [...hexes.keys()];

  cats.forEach((cat) => {
    ensureCatMotionFields(cat);
    if (!cat.appearance) {
      cat.appearance = createCat(cat.name, cat.hexKey).appearance;
    }
    if (!cat.hexKey || !hexes.has(cat.hexKey)) {
      cat.hexKey = allKeys[Math.floor(Math.random() * allKeys.length)];
    }

    // Ocupado caminando o en gesto/actividad
    if (cat.goalKey) return;
    if ((cat.behaviorUntil || 0) > now) return;

    const lowestNeed = NEEDS.reduce((lowest, need) => (
      cat.needs[need] < cat.needs[lowest] ? need : lowest
    ), NEEDS[0]);

    const needUrgent = cat.needs[lowestNeed] < 55;
    const suitable = [];
    if (needUrgent) {
      hexes.forEach((hex, key) => {
        const building = BUILDINGS[hex.building];
        if (building?.provides?.[lowestNeed]) suitable.push(key);
      });
    }

    const roll = Math.random();

    // Ir a cubrir necesidad urgente
    if (suitable.length && (needUrgent || roll < 0.45)) {
      const current = parseKey(cat.hexKey);
      suitable.sort((a, b) => {
        const pa = parseKey(a);
        const pb = parseKey(b);
        return hexDistance(current, pa) - hexDistance(current, pb);
      });
      const targetKey = suitable[0];
      const behavior = ACTIVITY_BY_NEED[lowestNeed];
      const duration = 4200 + Math.random() * 2800;
      if (targetKey === cat.hexKey) {
        cat.activity = behavior.activity;
        cat.activityLabel = behavior.label;
        cat.behaviorUntil = now + duration;
      } else {
        cat.goalKey = targetKey;
        cat.pendingActivity = {
          activity: behavior.activity,
          label: behavior.label,
          duration,
        };
        cat.activity = 'walk';
        cat.activityLabel = 'Caminando';
        cat.nextStepAt = now;
      }
      calcCatHappiness(cat);
      return;
    }

    // Gesto en el sitio
    if (roll < 0.42 && now > (cat.gestureCooldown || 0)) {
      const gesture = GESTURES[Math.floor(Math.random() * GESTURES.length)];
      cat.activity = gesture.activity;
      cat.activityLabel = gesture.label;
      cat.behaviorUntil = now + randomRange(gesture.duration);
      cat.gestureCooldown = now + 5000 + Math.random() * 4000;
      calcCatHappiness(cat);
      return;
    }

    // Paseo a una casilla vecina (o lejana a veces)
    let targetKey;
    if (roll < 0.78 || allKeys.length < 3) {
      targetKey = pickWanderTarget(cat.hexKey, hexes, allKeys);
    } else {
      targetKey = allKeys[Math.floor(Math.random() * allKeys.length)];
    }

    if (targetKey === cat.hexKey) {
      const gesture = GESTURES[Math.floor(Math.random() * GESTURES.length)];
      cat.activity = gesture.activity;
      cat.activityLabel = gesture.label;
      cat.behaviorUntil = now + randomRange(gesture.duration);
    } else {
      cat.goalKey = targetKey;
      cat.pendingActivity = {
        activity: 'explore',
        label: 'Explorando',
        duration: 1200 + Math.random() * 1800,
      };
      cat.activity = 'walk';
      cat.activityLabel = 'Caminando';
      cat.nextStepAt = now;
    }
    calcCatHappiness(cat);
  });
}

export function createNewGame(slot, catioName, difficultyId) {
  const diff = DIFFICULTIES[difficultyId] || DIFFICULTIES.normal;
  const hexes = generateInitialHexes(1);
  hexes.set(axialKey(0, 0), { q: 0, r: 0, building: 'food_bowl', level: 1 });

  const firstCat = createCat(generateCatName([]), axialKey(0, 0));

  return {
    slot,
    catioName: catioName || 'Mi Catio',
    difficulty: difficultyId,
    croquetas: diff.croquetas,
    hexes: Object.fromEntries(hexes),
    cats: [firstCat],
    selectedBuild: null,
    tick: 0,
    lastCatArrival: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tilesPurchased: 0,
  };
}

export function getTileCost(state) {
  const purchased = state.tilesPurchased ?? 0;
  return TILE_BASE_COST + purchased * TILE_COST_INCREMENT;
}

export function calcIncome(state) {
  const diff = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;
  const avgHappy = getAverageHappiness(state.cats);
  const base = 1 + Math.floor(avgHappy / 25);
  return base * diff.incomeMultiplier;
}

export function serializeHexes(hexesMap) {
  if (hexesMap instanceof Map) return Object.fromEntries(hexesMap);
  return hexesMap;
}

export function deserializeHexes(obj) {
  return new Map(Object.entries(obj));
}

export function canPlaceBuilding(state, hexKey, buildingId) {
  const hexes = deserializeHexes(state.hexes);
  if (buildingId === 'hex_tile') {
    const expandable = findExpandablePositions(hexes);
    return expandable.has(hexKey);
  }
  const hex = hexes.get(hexKey);
  return hex && !hex.building;
}

export function getUpgradeCost(buildingId, currentLevel) {
  const b = BUILDINGS[buildingId];
  if (!b?.upgradeable || currentLevel >= b.maxLevel) return null;
  return b.upgradeCosts[currentLevel - 1] ?? null;
}

export function tryUpgrade(state, hexKey) {
  const hexes = deserializeHexes(state.hexes);
  const hex = hexes.get(hexKey);
  if (!hex?.building) return { ok: false, reason: 'No hay edificio aquí' };
  const b = BUILDINGS[hex.building];
  if (!b?.upgradeable) return { ok: false, reason: 'No se puede mejorar' };
  const level = hex.level || 1;
  if (level >= b.maxLevel) return { ok: false, reason: 'Nivel máximo' };
  const cost = getUpgradeCost(hex.building, level);
  if (state.croquetas < cost) return { ok: false, reason: 'Croquetas insuficientes' };
  state.croquetas -= cost;
  hex.level = level + 1;
  state.hexes = serializeHexes(hexes);
  return { ok: true, newLevel: hex.level };
}

export function placeBuilding(state, hexKey, buildingId) {
  const hexes = deserializeHexes(state.hexes);
  const b = BUILDINGS[buildingId];
  if (!b) return { ok: false, reason: 'Edificio desconocido' };

  let cost = b.cost;
  if (buildingId === 'hex_tile') {
    cost = getTileCost(state);
    const expandable = findExpandablePositions(hexes);
    if (!expandable.has(hexKey)) return { ok: false, reason: 'Debe ser adyacente al catio' };
    if (state.croquetas < cost) return { ok: false, reason: 'Croquetas insuficientes' };
    const { q, r } = parseKey(hexKey);
    hexes.set(hexKey, { q, r, building: null, level: 1 });
    state.tilesPurchased++;
  } else {
    const hex = hexes.get(hexKey);
    if (!hex) return { ok: false, reason: 'Casilla inválida' };
    if (hex.building) return { ok: false, reason: 'Casilla ocupada' };
    if (state.croquetas < cost) return { ok: false, reason: 'Croquetas insuficientes' };
    hex.building = buildingId;
    hex.level = 1;
  }

  state.croquetas -= cost;
  state.hexes = serializeHexes(hexes);
  return { ok: true, cost };
}

export function trySpawnCat(state) {
  const hexes = deserializeHexes(state.hexes);
  const limit = calcCatLimit(hexes);
  if (state.cats.length >= limit.total) return false;

  const diff = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;
  const now = Date.now();
  if (now - state.lastCatArrival < diff.catArrivalRate) return false;

  const names = state.cats.map((c) => c.name);
  const name = generateCatName(names);
  const keys = [...hexes.keys()];
  const hexKey = keys[Math.floor(Math.random() * keys.length)];
  state.cats.push(createCat(name, hexKey));
  state.lastCatArrival = now;
  return true;
}

export function gameTick(state) {
  const diff = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;
  const hexes = deserializeHexes(state.hexes);

  state.cats.forEach((cat) => decayCatNeeds(cat, diff.needDecay));
  applyBuildingEffects(hexes, state.cats);
  assignCatPositions(state.cats, hexes);
  updateCatBehaviors(state.cats, hexes);
  updateCatMovement(state.cats, hexes);

  state.croquetas += calcIncome(state);
  trySpawnCat(state);

  state.tick++;
  state.updatedAt = Date.now();
  state.hexes = serializeHexes(hexes);
}
