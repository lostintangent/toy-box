import { Hydrate } from "@tanstack/react-start";
import { media } from "@tanstack/react-start/hydration";
import { DESKTOP_VIEWPORT_QUERY, MOBILE_VIEWPORT_QUERY } from "@/shared/hooks/useViewport";
import { DesktopWorkspaceLayout, type DesktopWorkspaceLayoutProps } from "./DesktopWorkspaceLayout";
import { MobileWorkspaceLayout, type MobileWorkspaceLayoutProps } from "./MobileWorkspaceLayout";

const mobileLayoutHydration = media(MOBILE_VIEWPORT_QUERY);
const desktopLayoutHydration = media(DESKTOP_VIEWPORT_QUERY);

export type WorkspaceLayoutProps = {
  hydrated: boolean;
  isMobile: boolean;
  mobile: Omit<MobileWorkspaceLayoutProps, "hydrated">;
  desktop: DesktopWorkspaceLayoutProps;
};

/** Renders both responsive SSR layouts while hydrating only the matching client composition. */
export function WorkspaceLayout({ hydrated, isMobile, mobile, desktop }: WorkspaceLayoutProps) {
  return (
    <div className="h-full overflow-hidden [&>[data-ts-hydrate-id]]:contents">
      {(!hydrated || isMobile) && (
        <Hydrate when={mobileLayoutHydration} split={false}>
          <MobileWorkspaceLayout {...mobile} hydrated={hydrated} />
        </Hydrate>
      )}
      {(!hydrated || !isMobile) && (
        <Hydrate when={desktopLayoutHydration} split={false}>
          <DesktopWorkspaceLayout {...desktop} />
        </Hydrate>
      )}
    </div>
  );
}
