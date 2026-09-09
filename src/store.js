const { ipcRenderer } = require('electron');

let _data = { decks: [] };
let _settings = { apiKey: '', model: 'claude-haiku-4-5-20251001', useAI: false };

export async function initStore() {
  _data = await ipcRenderer.invoke('data:load');
  if (!_data.decks) _data.decks = [];
  _settings = await ipcRenderer.invoke('settings:load');
}

export function decks() {
  return _data.decks;
}
export function getDeck(id) {
  return _data.decks.find((d) => d.id === id);
}
export function addDeck(deck) {
  _data.decks.unshift(deck);
  return save();
}
export function removeDeck(id) {
  _data.decks = _data.decks.filter((d) => d.id !== id);
  return save();
}
export function save() {
  return ipcRenderer.invoke('data:save', _data);
}

export function settings() {
  return _settings;
}
export function saveSettings(patch) {
  _settings = { ..._settings, ...patch };
  return ipcRenderer.invoke('settings:save', _settings);
}

// ---- bridges to main ----
export const pickWorksheet = () => ipcRenderer.invoke('pick:worksheet');
export const exportDeckFile = (name, text) => ipcRenderer.invoke('export:deck', { name, text });
export const ocrRecognize = (dataUrl, psm) => ipcRenderer.invoke('ocr:recognize', { dataUrl, psm });
export const onOcrProgress = (cb) => ipcRenderer.on('ocr:progress', (_e, m) => cb(m));
export const aiCall = (payload) => ipcRenderer.invoke('ai:call', payload);
