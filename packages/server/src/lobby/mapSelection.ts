import { MAP_OPTIONS } from '@eldorado/core';

/** Validate a map id; fall back to the first option or 'classic'. */
export function validateMapId(id: string | null | undefined): string {
  if (id && MAP_OPTIONS.some((m) => m.id === id)) return id;
  return MAP_OPTIONS[0]?.id ?? 'classic';
}
