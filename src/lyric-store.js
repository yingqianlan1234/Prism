export function createLyricIndexStore(initial = -1) {
  let current = initial;
  const listeners = new Set();

  return {
    getSnapshot() {
      return current;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setIndex(next) {
      if (next === current) return false;
      current = next;
      for (const listener of [...listeners]) {
        listener(current);
      }
      return true;
    },
  };
}
