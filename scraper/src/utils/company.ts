import { CompanyMetadata, JobOffer } from "../types";

/**
 * Normalizes a company website URL to ensure it has a valid web protocol and domain.
 * Returns undefined for empty strings, malformed URLs, sentinel placeholders (null, n/a),
 * or non-web schemes.
 */
export function normalizeCompanyUrl(url?: string | null): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (/^(null|undefined|n\/a|na|none|false|-)$/i.test(trimmed)) return undefined;

  let candidate = trimmed;
  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  } else if (!/^https?:\/\//i.test(candidate)) {
    // If it has another scheme like javascript:, mailto:, ftp:, reject
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
      return undefined;
    }
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    // Hostname must be non-empty and contain at least one dot (domain.tld)
    if (!parsed.hostname || !parsed.hostname.includes(".")) {
      return undefined;
    }
    return candidate;
  } catch {
    return undefined;
  }
}

/**
 * Builds a fallback Google search URL for a company when the direct website URL is missing.
 * Query pattern: https://www.google.com/search?q=${encodeURIComponent(companyName + ' software')}
 */
export function buildCompanySearchUrl(companyName?: string | null): string {
  const cleanName = (typeof companyName === "string" ? companyName : "")
    .trim()
    .replace(/\s+/g, " ");

  if (!cleanName) {
    return "https://www.google.com/search?q=software";
  }

  const query = `${cleanName} software`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * Alias for buildCompanySearchUrl for API flexibility.
 */
export const getCompanySearchUrl = buildCompanySearchUrl;

/**
 * Resolves the URL for a company, returning the direct website URL if available,
 * or falling back to a Google search URL.
 */
export function getCompanyUrl(
  companyOrOffer?: string | { company?: string; companyMeta?: CompanyMetadata } | null,
  maybeUrl?: string,
): string {
  const directFromMaybe = normalizeCompanyUrl(maybeUrl);

  if (typeof companyOrOffer === "string") {
    if (directFromMaybe) {
      return directFromMaybe;
    }
    return buildCompanySearchUrl(companyOrOffer);
  }

  if (!companyOrOffer) {
    if (directFromMaybe) {
      return directFromMaybe;
    }
    return buildCompanySearchUrl("");
  }

  const directUrl =
    normalizeCompanyUrl(companyOrOffer.companyMeta?.companyUrl) ??
    directFromMaybe;
  if (directUrl) {
    return directUrl;
  }

  return buildCompanySearchUrl(companyOrOffer.company);
}
