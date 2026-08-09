import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { z } from "zod";

export const hexColorSchema = z.templateLiteral(["#", z.string().regex(/^[0-9a-fA-F]{6}$/)]);

export type HexColor = z.output<typeof hexColorSchema>;

export function isHexColor(value: unknown): value is HexColor {
  return hexColorSchema.safeParse(value).success;
}

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
