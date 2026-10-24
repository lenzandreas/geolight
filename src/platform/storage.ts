/**
 * Persistence behind a tiny interface, so localStorage can later be swapped for
 * cloud sync, Capacitor Preferences, or a desktop file store.
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

class LocalStore implements KeyValueStore {
  private memory = new Map<string, string>();
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return this.memory.get(key) ?? null;
    }
  }
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      this.memory.set(key, value);
    }
  }
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      this.memory.delete(key);
    }
  }
}

export const store: KeyValueStore = new LocalStore();
