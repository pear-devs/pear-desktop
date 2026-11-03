// Fields grouped into cards, and the search over them.

import { type ConfigShape, type Field, onPlatform } from "@pear/sdk";

export interface Group {
  title: string | undefined;
  fields: [key: string, field: Field][];
}

export type FieldFilter = (key: string, field: Field) => boolean;
export type Localizer = (key: string, field: Field) => Field;

/** Consecutive fields with the same `group` form a card; fields for other platforms are left out. */
export function groupFields(shape: ConfigShape, platform: string, localized: Localizer, filter?: FieldFilter): Group[] {
  const groups: Group[] = [];
  for (const [key, original] of Object.entries(shape)) {
    const field = localized(key, original);
    if (!onPlatform(field.platforms, platform)) continue;
    if (filter && !filter(key, field)) continue;
    const last = groups.at(-1);
    if (last && last.title === field.group) last.fields.push([key, field]);
    else groups.push({ title: field.group, fields: [[key, field]] });
  }
  return groups;
}

/** Whether the schema has anything to show on this platform. */
export function hasFields(shape: ConfigShape, platform: string) {
  return Object.values(shape).some((field) => onPlatform(field.platforms, platform));
}

/** Whether any of the texts contains `needle` (lower-cased), ignoring case. */
export const matches = (needle: string, ...parts: (string | undefined)[]) =>
  parts.some((part) => part?.toLowerCase().includes(needle));

export const fieldMatches =
  (needle: string): FieldFilter =>
  (_, field) =>
    matches(needle, field.label, field.description);
