// Validated automation operations shared by the UI and SDK tools.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import {
  automationIdInputSchema,
  automationOptionsSchema,
  updateAutomationInputSchema,
} from "../model";
import * as lifecycle from "./index";

export const listAutomations = createServerFn({ method: "GET" }).handler(() =>
  lifecycle.listAutomations(),
);

export const createAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(automationOptionsSchema))
  .handler(({ data }) => lifecycle.createAutomation(data));

export const updateAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(updateAutomationInputSchema))
  .handler(async ({ data }) => {
    const { automationId, ...options } = data;
    const automation = await lifecycle.updateAutomation(automationId, options);
    if (!automation) throw new Error("Automation not found");
    return automation;
  });

export const deleteAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(automationIdInputSchema))
  .handler(({ data }) => lifecycle.deleteAutomation(data.automationId));

export const runAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(automationIdInputSchema))
  .handler(({ data }) => lifecycle.runAutomation(data.automationId));
