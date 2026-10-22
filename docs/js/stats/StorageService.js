// Thin localStorage wrapper (swap-friendly). Never throws: storage can be
// unavailable (privacy modes, quota) or hold corrupt JSON, and a stats failure
// must not stop the game from loading — callers fall back to defaults.
export const StorageService = {
    get(key) {
        try {
            const v = localStorage.getItem(key);
            return v ? JSON.parse(v) : null;
        } catch (e) {
            console.warn(`StorageService: could not read "${key}"`, e);
            return null;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.warn(`StorageService: could not write "${key}"`, e);
        }
    }
};
