/**
 * One field spec → both a zod validator and a JSON Schema for the model.
 * Keeps tool contracts and their validation in exactly one place.
 */
import { z } from 'zod';

export type FieldSpec =
  | { kind: 'string'; description?: string; maxLength?: number; enum?: readonly string[]; optional?: boolean }
  | { kind: 'integer'; description?: string; min?: number; max?: number; optional?: boolean }
  | { kind: 'number'; description?: string; min?: number; max?: number; optional?: boolean }
  | { kind: 'boolean'; description?: string; optional?: boolean }
  | { kind: 'array'; items: FieldSpec; description?: string; maxItems?: number; optional?: boolean }
  | { kind: 'object'; fields: Record<string, FieldSpec>; description?: string; optional?: boolean };

export function toJsonSchema(spec: FieldSpec): Record<string, unknown> {
  switch (spec.kind) {
    case 'string': {
      const out: Record<string, unknown> = { type: 'string' };
      if (spec.description) out.description = spec.description;
      if (spec.maxLength) out.maxLength = spec.maxLength;
      if (spec.enum) out.enum = [...spec.enum];
      return out;
    }
    case 'integer': {
      const out: Record<string, unknown> = { type: 'integer' };
      if (spec.description) out.description = spec.description;
      if (spec.min !== undefined) out.minimum = spec.min;
      if (spec.max !== undefined) out.maximum = spec.max;
      return out;
    }
    case 'number': {
      const out: Record<string, unknown> = { type: 'number' };
      if (spec.description) out.description = spec.description;
      if (spec.min !== undefined) out.minimum = spec.min;
      if (spec.max !== undefined) out.maximum = spec.max;
      return out;
    }
    case 'boolean': {
      const out: Record<string, unknown> = { type: 'boolean' };
      if (spec.description) out.description = spec.description;
      return out;
    }
    case 'array': {
      const out: Record<string, unknown> = { type: 'array', items: toJsonSchema(spec.items) };
      if (spec.description) out.description = spec.description;
      if (spec.maxItems) out.maxItems = spec.maxItems;
      return out;
    }
    case 'object': {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(spec.fields)) {
        properties[key] = toJsonSchema(value);
        if (!value.optional) required.push(key);
      }
      const out: Record<string, unknown> = { type: 'object', properties };
      if (required.length) out.required = required;
      if (spec.description) out.description = spec.description;
      return out;
    }
  }
}

function toZod(spec: FieldSpec): z.ZodTypeAny {
  switch (spec.kind) {
    case 'string': {
      let base = z.string();
      if (spec.maxLength) base = base.max(spec.maxLength);
      if (spec.enum && spec.enum.length > 0) {
        return z.enum(spec.enum as [string, ...string[]]);
      }
      return base;
    }
    case 'integer': {
      let base = z.number().int();
      if (spec.min !== undefined) base = base.min(spec.min);
      if (spec.max !== undefined) base = base.max(spec.max);
      return base;
    }
    case 'number': {
      let base = z.number();
      if (spec.min !== undefined) base = base.min(spec.min);
      if (spec.max !== undefined) base = base.max(spec.max);
      return base;
    }
    case 'boolean':
      return z.boolean();
    case 'array': {
      let base = z.array(toZod(spec.items));
      if (spec.maxItems) base = base.max(spec.maxItems);
      return base;
    }
    case 'object': {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, value] of Object.entries(spec.fields)) {
        shape[key] = value.optional ? toZod(value).optional() : toZod(value);
      }
      return z.object(shape);
    }
  }
}

export function defineObject(fields: Record<string, FieldSpec>): {
  zod: z.ZodTypeAny;
  jsonSchema: Record<string, unknown>;
} {
  const spec: FieldSpec = { kind: 'object', fields };
  return { zod: toZod(spec), jsonSchema: toJsonSchema(spec) };
}
