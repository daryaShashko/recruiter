/**
 * Canonical ATS company name mapping (slug -> Display Company Name).
 * Used by Ashby and Lever scrapers where individual job objects lack company names.
 */
export const ATS_COMPANY_NAMES: Readonly<Record<string, string>> = {
  // Ashby
  linear: "Linear",
  supabase: "Supabase",
  n8n: "n8n",
  ramp: "Ramp",
  lovable: "Lovable",
  synthesia: "Synthesia",
  elevenlabs: "ElevenLabs",
  incident: "Incident.io",
  attio: "Attio",

  // Lever
  spotify: "Spotify",
  matillion: "Matillion",
  contentsquare: "Contentsquare",
  swile: "Swile",
};

/**
 * Resolve display company name for an ATS slug.
 * Falls back to slug if unknown.
 */
export function getAtsCompanyName(slug: string): string {
  return ATS_COMPANY_NAMES[slug.toLowerCase()] ?? slug;
}
