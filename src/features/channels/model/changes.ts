/** An omitted or undefined field leaves its current value alone. */
export function hasChanges(changes: object): boolean {
  return Object.values(changes).some((value) => value !== undefined);
}

/** Undefined leaves a property alone; null removes an optional property. */
export function applyPatch<Value extends object>(
  current: Value,
  changes: { [Key in keyof Value]?: Value[Key] | null },
): Value {
  const next = { ...current };
  for (const key in changes) {
    const value = changes[key];
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return next;
}
