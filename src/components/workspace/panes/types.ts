/** Host-provided presentation for session and editor views. The desktop grid
 *  uses normal/icon controls; pagers use compact/labeled controls. */
export type PaneVariant = "normal" | "compact";

export type PaneProps = {
  variant?: PaneVariant;
};
