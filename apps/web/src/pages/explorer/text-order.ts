/** Code-unit comparison. Never localeCompare: ordering must not depend on the locale. */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}
