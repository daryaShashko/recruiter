/**
 * Unified job offer interface.
 * All scrapers must normalize their output to this shape.
 */
export interface JobOffer {
  /** Unique identifier from the source board (e.g. justjoin slug, nofluffjobs id) */
  id: string;
  /** Job title as listed */
  title: string;
  /** Company name */
  company: string;
  /** Direct URL to the job posting */
  url: string;
  /** Full job description text */
  body: string;
  /** Source board identifier */
  source: 'justjoin' | 'nofluffjobs' | 'linkedin' | 'manual';
  /** Location string (city or "Remote") */
  location?: string;
  /** Salary range string if available */
  salary?: string;
  /** Required tech stack tags */
  tags?: string[];
  /** ISO timestamp when this offer was scraped */
  scrapedAt: string;
}

/**
 * Payload sent to the n8n Webhook.
 */
export interface WebhookPayload {
  jobs: JobOffer[];
  meta: {
    source: string;
    count: number;
    sentAt: string;
  };
}

/**
 * LLM evaluation result from Ollama.
 */
export interface EvaluationResult {
  match: boolean;
  reason: string;
  url: string;
}
