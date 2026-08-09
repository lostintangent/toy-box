import { z, type JSONType } from "zod";
import { smallJsonSchema } from "@/shared/smallJson";

const appStateDefinitionInputSchema = z
  .object({
    schema: z.unknown(),
    default: z.unknown(),
  })
  .strict();

const validators = new Map<JSONType, z.ZodType>();

export const appStateDefinitionSchema = z.unknown().transform((value, context) => {
  try {
    return parseAppStateDefinitionValue(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : String(error),
    });
    return z.NEVER;
  }
});

export type AppStateDefinition = z.output<typeof appStateDefinitionSchema>;

export function parseAppStateDefinition(value: unknown): AppStateDefinition {
  return appStateDefinitionSchema.parse(value);
}

function parseAppStateDefinitionValue(value: unknown) {
  const input = appStateDefinitionInputSchema.parse(value);
  const schema = parseAppStateSchema(input.schema);
  return { schema, default: parseAppState(schema, input.default) };
}

export function parseAppStateSchema(value: unknown): JSONType {
  const json = smallJsonSchema.parse(value);
  if (
    typeof json !== "boolean" &&
    (typeof json !== "object" || json === null || Array.isArray(json))
  ) {
    throw new Error("App state schema must be a JSON Schema object or boolean.");
  }
  appStateValidator(json);
  return json;
}

export function parseAppState(schema: JSONType, value: unknown): JSONType {
  const json = smallJsonSchema.parse(value);
  return smallJsonSchema.parse(appStateValidator(schema).parse(json));
}

function appStateValidator(schema: JSONType): z.ZodType {
  let validator = validators.get(schema);
  if (!validator) {
    validator = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0], {
      defaultTarget: "draft-2020-12",
    });
    validators.set(schema, validator);
  }
  return validator;
}
