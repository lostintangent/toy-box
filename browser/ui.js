export function getRequiredElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element #${id}.`);
  return element;
}

export function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}
