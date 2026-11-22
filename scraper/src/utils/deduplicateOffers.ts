import { JobOffer } from "../types";

/**
 * Deduplicate job offers by comparing `fingerprint` first when available,
 * and falling back to `id` when `fingerprint` is missing or empty.
 */
export function deduplicateOffers(offers: JobOffer[]): JobOffer[] {
  const seenFingerprints = new Set<string>();
  const seenIds = new Set<string>();

  return offers.filter((offer) => {
    if (offer.fingerprint) {
      if (seenFingerprints.has(offer.fingerprint)) {
        return false;
      }
      seenFingerprints.add(offer.fingerprint);
      seenIds.add(offer.id);
      return true;
    }

    if (seenIds.has(offer.id)) {
      return false;
    }
    seenIds.add(offer.id);
    return true;
  });
}
