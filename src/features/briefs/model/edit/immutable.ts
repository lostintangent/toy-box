/**
 * Structural sharing for immutable brief edits: rebuild only the owners whose
 * elements actually changed, so a transition that changes nothing returns its input.
 */

type ArrayKey<Owner> = {
  [Key in keyof Owner]-?: NonNullable<Owner[Key]> extends readonly unknown[] ? Key : never;
}[keyof Owner];

type ElementOf<Value> = NonNullable<Value> extends readonly (infer Element)[] ? Element : never;

/**
 * Rebuild `owner[key]` from each element's transition; returning `undefined`
 * removes it. An absent optional list is unchanged.
 */
export function mapEach<Owner extends object, Key extends ArrayKey<Owner>>(
  owner: Owner,
  key: Key,
  transition: (element: ElementOf<Owner[Key]>) => ElementOf<Owner[Key]> | undefined,
): Owner {
  const elements = (owner[key] ?? []) as readonly ElementOf<Owner[Key]>[];
  const next = elements.flatMap((element) => {
    const result = transition(element);
    return result === undefined ? [] : [result];
  });
  const unchanged =
    next.length === elements.length && next.every((element, index) => element === elements[index]);
  return unchanged ? owner : { ...owner, [key]: next };
}
