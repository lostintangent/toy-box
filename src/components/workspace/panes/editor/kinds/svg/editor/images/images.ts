import type { EditorStore } from "../../store";

export const SVG_RASTER_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MAX_IMAGE_FILE_SIZE_BYTES = 35_000_000;

export function isSupportedSvgImage(file: Pick<Blob, "size" | "type">): boolean {
  return SVG_RASTER_IMAGE_TYPES.has(file.type) && file.size <= MAX_IMAGE_FILE_SIZE_BYTES;
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function loadBrowserImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be loaded."));
    image.src = source;
  });
}

/** Decodes one browser image file and inserts it through the editor store. */
export async function insertImageFile(store: EditorStore, file: File): Promise<void> {
  if (!isSupportedSvgImage(file)) {
    console.error("SVG images must be PNG, JPEG, GIF, or WebP files smaller than 35 MB.");
    return;
  }

  try {
    const source = await fileToDataUrl(file);
    const image = await loadBrowserImage(source);
    store.actions.insertImage(source, {
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
  } catch (error) {
    console.error("Unable to insert image into the SVG artifact:", error);
  }
}

export async function writeSvgImageToClipboard(
  source: string,
  page: { width: number; height: number },
  backgroundColor: string,
): Promise<void> {
  const scale = Math.min(1, 4096 / Math.max(page.width, page.height));
  const width = Math.max(1, Math.ceil(page.width * scale));
  const height = Math.max(1, Math.ceil(page.height * scale));
  const imageUrl = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
  try {
    const image = await loadBrowserImage(imageUrl);
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The canvas could not be created.");
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The canvas could not be encoded."));
    }, "image/png");
  });
}
