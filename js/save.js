const SAVE_KEY = 'catio_builder_saves';
const MAX_SLOTS = 3;

export function loadAllSaves() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return Array(MAX_SLOTS).fill(null);
    const data = JSON.parse(raw);
    const slots = Array(MAX_SLOTS).fill(null);
    data.forEach((save, i) => {
      if (i < MAX_SLOTS) slots[i] = save;
    });
    return slots;
  } catch {
    return Array(MAX_SLOTS).fill(null);
  }
}

export function saveGame(state) {
  const slots = loadAllSaves();
  state.updatedAt = Date.now();
  slots[state.slot] = { ...state };
  localStorage.setItem(SAVE_KEY, JSON.stringify(slots));
}

export function deleteSave(slot) {
  const slots = loadAllSaves();
  slots[slot] = null;
  localStorage.setItem(SAVE_KEY, JSON.stringify(slots));
}

export function autoSave(state) {
  if (state) saveGame(state);
}

export function getSaveMeta(save) {
  if (!save) return null;
  return {
    catioName: save.catioName,
    difficulty: save.difficulty,
    cats: save.cats?.length ?? 0,
    croquetas: Math.floor(save.croquetas ?? 0),
    updatedAt: save.updatedAt,
    tiles: Object.keys(save.hexes || {}).length,
  };
}
