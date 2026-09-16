import { dirname } from "node:path";
import { sessionArtifactsDirectory } from "./artifacts";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";

export function buildSessionSystemPrompt(
  sessionId: string,
  options: {
    directory?: string;
    model?: ModelConfiguration;
    artifactPath?: string;
    additionalInstructions?: string;
  },
) {
  const { additionalInstructions, artifactPath, directory, model } = options;

  const parts: string[] = [];

  if (model) {
    parts.push(`This session is using model configuration: ${JSON.stringify(model)}.`);
  }

  if (directory) {
    parts.push(
      `The user's current working directory is: ${directory}. Unless otherwise specified, all mentioned file paths should be interpreted relative to this directory, and file operations should target this location.`,
    );
  }

  const artifactsDirectory = sessionArtifactsDirectory(sessionId);
  const sessionStateDirectory = dirname(artifactsDirectory);
  parts.push(
    `This session's ID is: ${sessionId}.`,
    `This session's state folder is: ${sessionStateDirectory}. This session's artifacts folder is: ${artifactsDirectory}. Unless otherwise specified, when the user asks you to create an artifact, spec, plan, or session document, write it under the artifacts folder. If this session does not have a working directory, use this artifacts folder as the default location for new files.`,
  );

  if (artifactPath) {
    parts.push(
      `The draft began with the artifact \`${artifactPath}\`, which is the center of the user's initial discussion. Read and update that file when the user's request refers to the document, diagram, or artifact without naming a path.`,
    );
  }

  parts.push(
    'Toy Box renders files ending in `.svg` as rich, directly editable drawing artifacts. When creating a whiteboard, drawing, or spatial diagram, write standard static SVG with an `xmlns`, a meaningful `viewBox`, and ordinary SVG elements such as `<g>`, `<path>`, `<rect>`, `<ellipse>`, `<line>`, `<text>`, and `<image>`. Gradients, filters, masks, patterns, markers, and transforms are supported. Give logical objects unique, descriptive IDs and wrap multi-part objects in `<g id="...">` so Toy Box can select, move, resize, and rotate them as one unit. Keep the file self-contained when practical. The editor supplies its own theme-derived background and dot grid, so do not add a background unless it is meaningful document content. Editable SVG artifacts must not contain doctypes, scripts, `<foreignObject>`, event-handler attributes, imported or executable CSS, or unsafe resource protocols.',
  );

  if (additionalInstructions) parts.push(additionalInstructions);

  return parts.join("\n\n");
}

export const SESSION_HISTORY_DISCOVERY_INSTRUCTIONS =
  "Use list_sessions and read_session to discover and read Toy Box sessions across providers.";
