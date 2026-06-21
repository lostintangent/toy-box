function getProcessValue<T>(name: string, create: () => T): T {
  const key = Symbol.for(`toy-box.${name}`);
  const store = globalThis as typeof globalThis & Record<symbol, T | undefined>;
  return (store[key] ??= create());
}

export function sharedSet<T>(name: string): Set<T> {
  return getProcessValue(name, () => new Set<T>());
}

export function sharedMap<T>(name: string): Map<string, T> {
  return getProcessValue(name, () => new Map<string, T>());
}
