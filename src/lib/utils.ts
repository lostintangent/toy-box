import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate a UUID v4 string.
 * Uses crypto.randomUUID() when available (secure contexts),
 * falls back to crypto.getRandomValues() for non-secure contexts (e.g., HTTP on mobile).
 */
export function generateUUID(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Fallback using getRandomValues (available in all contexts)
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Set version (4) and variant (RFC 4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Convert absolute path to relative path with ~ for home directory.
 * TODO: Have the server provide the home directory to avoid regex patterns.
 */
export function toRelativePath(absolutePath: string, cwd?: string): string {
  // If a CWD is provided and the path starts with it, show relative to CWD
  if (cwd) {
    const normalizedCwd = cwd.endsWith("/") ? cwd : `${cwd}/`;
    if (absolutePath.startsWith(normalizedCwd)) {
      return absolutePath.slice(normalizedCwd.length);
    }
    if (absolutePath === cwd) {
      return ".";
    }
  }

  const homePatterns = [
    /^\/Users\/[^/]+\//, // macOS: /Users/username/
    /^\/home\/[^/]+\//, // Linux: /home/username/
    /^C:\\Users\\[^\\]+\\/i, // Windows: C:\Users\username\
  ];

  for (const pattern of homePatterns) {
    if (pattern.test(absolutePath)) {
      return absolutePath.replace(pattern, "~/");
    }
  }

  return absolutePath;
}
