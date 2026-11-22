// FNV-1a 64-bit hash implementation (hex string, 16 chars)
// Reference: http://isthe.com/chongo/tech/comp/fNV/
export function calcFingerprint(company: string, title: string): string {
  const fnvOffset = BigInt('0xcbf29ce484222325');
  const fnvPrime = BigInt('0x100000001b3');
  let hash = fnvOffset;
  const input = `${company}::${title}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * fnvPrime) & BigInt('0xFFFFFFFFFFFFFFFF'); // 64-bit overflow
  }
  // Return as 16-char hex, padded with leading zeros
  return hash.toString(16).padStart(16, '0');
}
