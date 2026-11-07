/**
 * Capitalise the first letter of each name part as the user types.
 * Handles spaces, hyphens, and apostrophes (e.g. Mary-Jane, O'Brien).
 */
export function capitalizeName(value: string): string {
  return value.replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}
