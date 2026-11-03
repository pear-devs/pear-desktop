// The routes' body schemas: checking a request body, and as JSON schema for the
// OpenAPI document.

import type { BodySchema, FieldType } from "./types.ts";

type FieldSpec = BodySchema[string];

const VALID: Record<FieldType, (value: unknown) => boolean> = {
  integer: (value) => typeof value === "number" && Number.isInteger(value) && value >= 0,
  number: (value) => typeof value === "number" && Number.isFinite(value),
  string: (value) => typeof value === "string",
  boolean: (value) => typeof value === "boolean",
};

const EXPECTED: Record<FieldType, string> = {
  integer: "a non-negative integer",
  number: "a number",
  string: "a string",
  boolean: "a boolean",
};

function parseType(type: `${FieldType}` | `${FieldType}?`) {
  const optional = type.endsWith("?");
  // The template literal type guarantees what's left is a FieldType.
  const base = type.replace("?", "") as FieldType;
  return { base, optional };
}

/** Validates a JSON body against a schema; returns an error message or null. */
export function validateBody(schema: BodySchema, body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "expected a JSON object";
  const record: Record<string, unknown> = { ...body };
  for (const [key, spec] of Object.entries(schema)) {
    const error = fieldError(key, spec, record[key]);
    if (error) return error;
  }
  return null;
}

function fieldError(key: string, spec: FieldSpec, value: unknown) {
  if (typeof spec !== "string") {
    if (value === undefined || spec.includes(value as string)) return null;
    return `${key} must be one of ${spec.join(", ")}`;
  }
  const { base, optional } = parseType(spec);
  if (value === undefined && optional) return null;
  return VALID[base](value) ? null : `${key} must be ${EXPECTED[base]}`;
}

export function jsonSchema(schema: BodySchema) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, spec] of Object.entries(schema)) {
    if (typeof spec !== "string") {
      properties[key] = { type: "string", enum: spec };
      continue;
    }
    const { base, optional } = parseType(spec);
    if (!optional) required.push(key);
    properties[key] = { type: base };
  }
  return { type: "object", properties, required };
}
