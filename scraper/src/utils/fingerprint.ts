// FNV-1a 64-bit hash of normalized `company::title` (hex string, 16 chars).
// Mirrors the n8n `Code: Normalize Jobs` strategy (ADR in context/decisions.yaml):
// strip legal forms from company, strip seniority prefixes from title,
// normalize common abbreviations. Reference: http://isthe.com/chongo/tech/comp/fNV/

const LEGAL_FORMS =
  /\b(?:sp\.?\s*z\s*o\.?\s*o\.?|sp\.?\s*k\.?|s\.?\s*a\.?|inc\.?|ltd\.?|llc|gmbh|ag|corp\.?|corporation|plc|bv|oy|ab|as|aps)(?=\s|$|[^a-z0-9])/gi;

const SENIORITY =
  /\b(?:senior|sr|junior|jr|lead|principal|staff|mid|regular|intern|trainee)\b/gi;

const GENDER_NOISE = /\((?:m\/f\/d|m\/w\/d|f\/m\/d|m\/f|k\/m|all genders)\)/gi;

export function normalizeFingerprintCompany(company: string): string {
  return company
    .toLowerCase()
    .replace(LEGAL_FORMS, " ")
    .replace(/[^a-z0-9ąćęłńóśźż]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeFingerprintTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(GENDER_NOISE, " ")
    .replace(/\bfull[\s-]*stack\b/g, "fullstack")
    .replace(/\bfront[\s-]*end\b/g, "frontend")
    .replace(/\bback[\s-]*end\b/g, "backend")
    .replace(/\bnode[\s.]*js\b/g, "nodejs")
    .replace(/\breact[\s.]*js\b/g, "react")
    .replace(SENIORITY, " ")
    .replace(/[^a-z0-9ąćęłńóśźż#+]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function calcFingerprint(company: string, title: string): string {
  const fnvOffset = BigInt("0xcbf29ce484222325");
  const fnvPrime = BigInt("0x100000001b3");
  let hash = fnvOffset;
  const input = `${normalizeFingerprintCompany(company)}::${normalizeFingerprintTitle(title)}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * fnvPrime) & BigInt("0xFFFFFFFFFFFFFFFF"); // 64-bit overflow
  }
  return hash.toString(16).padStart(16, "0");
}
