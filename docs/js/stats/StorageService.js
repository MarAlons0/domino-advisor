export const StorageService = {
    get(key) { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; },
    set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
};
