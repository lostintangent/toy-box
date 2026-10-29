import type { ComponentProps } from "react";
import { defaultRehypePlugins, type Components, type ExtraProps } from "streamdown";
import { sessionFile } from "@files/model";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { createEditorPaneId } from "@workspace/model/panes";
import type { SessionArtifact } from "../../../model";
import { useCurrentSession } from "../../CurrentSessionContext";

type TranscriptLinkProps = ComponentProps<"a"> & ExtraProps;

function artifactPathFromHref(href: string | undefined): string | undefined {
  if (
    !href ||
    href.startsWith("/") ||
    href.startsWith("#") ||
    href.startsWith("?") ||
    /^[a-z][a-z\d+.-]*:/i.test(href)
  ) {
    return undefined;
  }

  try {
    const decoded = decodeURIComponent(href.split(/[?#]/, 1)[0]).replaceAll("\\", "/");
    if (decoded.startsWith("/")) return undefined;

    const segments = decoded.split("/");
    if (segments.includes("..")) return undefined;

    const path = segments.filter((segment) => segment && segment !== ".").join("/");
    return path || undefined;
  } catch {
    return undefined;
  }
}

export function resolveTranscriptArtifactPath(
  href: string | undefined,
  sessionId: string,
  panes: readonly { id: string }[],
  artifacts: readonly SessionArtifact[] = [],
): string | undefined {
  const path = artifactPathFromHref(href);
  if (!path) return undefined;

  const paneId = createEditorPaneId(sessionFile(sessionId, path));
  return panes.some((pane) => pane.id === paneId) ||
    artifacts.some((artifact) => artifact.path === path)
    ? path
    : undefined;
}

function TranscriptLink({ node: _node, href, children, ...linkProps }: TranscriptLinkProps) {
  const { sessionId, artifacts, onOpenArtifact } = useCurrentSession();
  const { focusedPaneAtom, panes } = useWorkspaceSurface();
  const artifactPath = resolveTranscriptArtifactPath(
    href,
    sessionId,
    panes,
    onOpenArtifact ? artifacts : undefined,
  );

  if (!href) return <span>{children}</span>;

  if (!artifactPath) {
    const external = /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//");
    return (
      <a
        {...linkProps}
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className="wrap-anywhere font-medium text-primary underline"
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type="button"
      title={`Open ${artifactPath}`}
      className="wrap-anywhere appearance-none text-left font-medium text-primary underline"
      data-incomplete="false"
      data-streamdown="link"
      onClick={() =>
        onOpenArtifact && artifacts?.some(({ path }) => path === artifactPath)
          ? onOpenArtifact(artifactPath)
          : focusedPaneAtom.set(createEditorPaneId(sessionFile(sessionId, artifactPath)))
      }
    >
      {children}
    </button>
  );
}

export const transcriptLinkComponents = {
  a: TranscriptLink,
} satisfies Components;

// Sanitization still strips unsafe HTML and URL protocols. Omitting harden
// preserves relative hrefs so Toy Box can interpret them as session files.
export const transcriptRehypePlugins = [defaultRehypePlugins.raw, defaultRehypePlugins.sanitize];
