const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function canonicalizeEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  return EMAIL.test(value) ? value : null;
}
