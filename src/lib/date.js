export function utcDate() {
  return new Date().toISOString().slice(0, 10);
}
