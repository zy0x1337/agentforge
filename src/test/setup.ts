// Global Vitest setup
// - Polyfill performance.now for Node environments that need it
// - Extend matchers if needed in future

if (typeof performance === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).performance = {
    now: () => Date.now(),
  };
}
