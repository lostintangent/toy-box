/** An omitted or undefined field leaves its current value alone. */
export function hasChanges(changes: object): boolean {
  return Object.values(changes).some((value) => value !== undefined);
}
