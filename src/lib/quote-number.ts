// Generates a client-facing quote reference like "APF-2026-K3J9F".
// Year groups them chronologically; the base36 suffix from the timestamp
// keeps them unique and short enough to read over the phone.
export function generateQuoteNumber(): string {
  const year = new Date().getFullYear();
  const suffix = Date.now().toString(36).slice(-5).toUpperCase();
  return `APF-${year}-${suffix}`;
}
