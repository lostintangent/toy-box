/** Re-key a feature glob's matches by the feature folder each came from. */
export function byFeature<Module>(modules: Record<string, Module>): Record<string, Module> {
  return Object.fromEntries(
    Object.entries(modules).map(([path, module]) => [
      path.split("/features/")[1].split("/")[0],
      module,
    ]),
  );
}
