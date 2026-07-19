import { DIFFICULTIES, NEEDS, CAT_NAMES, BUILDINGS, BASE_CAT_LIMIT, HAPPINESS_WARNING_THRESHOLD, TILE_BASE_COST, TILE_COST_INCREMENT } from './config.js';
import { generateInitialHexes, axialKey, hexNeighbors, parseKey, findExpandablePositions, getTilesInRange } from './hex.js';

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
  NEEDS.forEach((n) => { needs[n] = 80 + Math.random() * 20; });
  const coats = [
    { coat: '#d19a62', dark: '#8c5c38', light: '#f2d0a5', pattern: 'tabby', eyes: '#79a95b' },
    { coat: '#ddd4c8', dark: '#766f70', light: '#fff8ed', pattern: 'patches', eyes: '#70a8ba' },
    { coat: '#4d4850', dark: '#292630', light: '#a59ba5', pattern: 'solid', eyes: '#d6b64f' },
    { coat: '#b97855', dark: '#674434', light: '#ead0b6', pattern: 'tuxedo', eyes: '#8caf58' },
    { coat: '#c8b7a0', dark: '#695f5b', light: '#f1e6d7', pattern: 'points', eyes: '#69a7c7' },
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

export function updateCatBehaviors(cats, hexes) {
  if (!hexes.size) return;
  const now = Date.now();
  const allKeys = [...hexes.keys()];

  cats.forEach((cat) => {
    if (!cat.appearance) {
      const fallback = createCat(cat.name, cat.hexKey).appearance;
      cat.appearance = fallback;
    }

    if ((cat.behaviorUntil || 0) > now && hexes.has(cat.hexKey)) {
      const need = Object.entries(ACTIVITY_BY_NEED)
        .find(([, value]) => value.activity === cat.activity)?.[0];
      if (need && cat.needs[need] !== undefined) {
        cat.needs[need] = Math.min(100, cat.needs[need] + 0.35);
      }
      return;
    }

    const lowestNeed = NEEDS.reduce((lowest, need) => (
      cat.needs[need] < cat.needs[lowest] ? need : lowest
    ), NEEDS[0]);

    const suitable = [];
    hexes.forEach((hex, key) => {
      const building = BUILDINGS[hex.building];
      if (building?.provides?.[lowestNeed]) suitable.push(key);
    });

    const current = parseKey(cat.hexKey || allKeys[0]);
    let targetKey;
    if (suitable.length) {
      suitable.sort((a, b) => {
        const pa = parseKey(a);
        const pb = parseKey(b);
        const da = Math.abs(pa.q - current.q) + Math.abs(pa.r - current.r);
        const db = Math.abs(pb.q - current.q) + Math.abs(pb.r - current.r);
        return da - db;
      });
      targetKey = suitable[0];
      const behavior = ACTIVITY_BY_NEED[lowestNeed];
      cat.activity = behavior.activity;
      cat.activityLabel = behavior.label;
      cat.behaviorUntil = now + 6500 + Math.random() * 3500;
    } else {
      const currentHex = parseKey(cat.hexKey || allKeys[0]);
      const nearby = hexNeighbors(currentHex.q, currentHex.r)
        .map((position) => axialKey(position.q, position.r))
        .filter((key) => hexes.has(key));
      targetKey = nearby.length
        ? nearby[Math.floor(Math.random() * nearby.length)]
        : allKeys[Math.floor(Math.random() * allKeys.length)];
      const idleActivities = [
        ['explore', 'Explorando'],
        ['groom', 'Aseándose'],
        ['watch', 'Observando'],
      ];
      const idle = idleActivities[Math.floor(Math.random() * idleActivities.length)];
      cat.activity = idle[0];
      cat.activityLabel = idle[1];
      cat.behaviorUntil = now + 4000 + Math.random() * 3500;
    }

    cat.hexKey = targetKey;
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

  state.croquetas += calcIncome(state);
  trySpawnCat(state);

  state.tick++;
  state.updatedAt = Date.now();
  state.hexes = serializeHexes(hexes);
}
