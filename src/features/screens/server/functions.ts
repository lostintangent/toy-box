import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { screenRuntime } from "./runtime";

export const listScreens = createServerFn({ method: "GET" }).handler(() => screenRuntime.list());

/** A screen's thumbnail as a JPEG data URL, for the screen browser. */
export const getScreenThumbnail = createServerFn({ method: "GET" })
  .validator(z.string().min(1))
  .handler(
    async ({ data: screenId }) =>
      `data:image/jpeg;base64,${await screenRuntime.thumbnail(screenId)}`,
  );
