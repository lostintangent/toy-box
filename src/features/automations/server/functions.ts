// Automation catalog and validated commands for UI clients.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import {
  automationIdInputSchema,
  automationOptionsSchema,
  runAutomationInputSchema,
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
  .handler(({ data }) => {
    const { automationId, ...options } = data;
    return lifecycle.updateAutomation(automationId, options);
  });

export const deleteAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(automationIdInputSchema))
  .handler(({ data }) => lifecycle.deleteAutomation(data.automationId));

export const runAutomation = createServerFn({ method: "POST" })
  .validator(zodValidator(runAutomationInputSchema))
  .handler(({ data }) => lifecycle.runAutomation(data.automationId, data.clientId));
