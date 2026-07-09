/** Host-provided presentation for session and artifact views. The desktop grid
 *  uses normal/icon controls; pagers use compact/labeled controls. A supplied
 *  actions slot lets the pane portal its controls into the host chrome. */
export type PaneVariant = "normal" | "compact";

export type PaneProps = {
  variant?: PaneVariant;
  actionsSlot?: HTMLElement | null;
};
