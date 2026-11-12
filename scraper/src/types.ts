/**
 * Metadata about the hiring company extracted from source API or external lookups.
 */
export interface CompanyMetadata {
  /** Company size or employee count range (e.g. "10-50", "200+") */
  size?: string;
  /** Direct URL to company website */
  companyUrl?: string;
  /** Type of advertiser (e.g. "direct", "agency") */
  advertiserType?: string;
  /** Industry sector */
  industry?: string;
}

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
  source:
    | 'justjoin'
    | 'nofluffjobs'
    | 'linkedin'
    | 'manual'
    | 'thehub'
    | 'swissdevjobs'
    | 'greenhouse'
    | 'lever'
    | 'ashby'
    | 'adzuna'
    | 'workable'
    | 'recruitee'
    | 'personio';
  /** Location string (city or "Remote") */
  location?: string;
  /** Salary range string if available */
  salary?: string;
  /** Required tech stack tags */
  tags?: string[];
  /** Metadata about the hiring company */
  companyMeta?: CompanyMetadata;
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
 * LLM evaluation result from Ollama/Gemini.
 */
export interface EvaluationResult {
  match: boolean;
  reason: string;
  url: string;
  company_dossier?: string;
  companyMeta?: CompanyMetadata;
}

export {
  buildCompanySearchUrl,
  getCompanySearchUrl,
  getCompanyUrl,
  normalizeCompanyUrl,
} from './utils/company';

export {
  buildDismissedKeyboard,
  buildNotionStatusUpdatePayload,
  buildPromotedKeyboard,
  buildTopic2HotMatchKeyboard,
  buildTopic3ReviewKeyboard,
  compactNotionPageId,
  encodeCallback,
  formatTelegramAlertMessage,
  parseCallbackData,
  TelegramActionType,
  TelegramAlertJobInput,
  TelegramCallbackAction,
  TelegramInlineKeyboardButton,
  TelegramInlineKeyboardMarkup,
} from './utils/telegram';

export {
  buildTelegramApplicationPackage,
  formatTelegramDeliveryHtml,
  ApplicationDeliveryOptions,
} from './generator/telegram-delivery';

export {
  generateLinkedInPitch,
  LinkedInPitchOptions,
  LinkedInPitchResult,
} from './generator/cover-letter';

export {
  getBaseCvPdf,
} from './generator/cv-renderer';

export {
  TelegramApplicationPackage,
} from './generator/types';

export {
  REJECT_REASONS,
  RejectReasonCode,
  buildTopic2RejectReasonsKeyboard,
  buildRejectReasonConfirmationKeyboard,
  buildEvaluationLogFeedbackPatch,
} from './utils/telegram';

export {
  EvaluationLogRecord,
  SynthesizedRuleDraft,
  RuleProposalMessage,
  analyzeFeedbackPatterns,
  formatRuleActivationProposal,
  normalizeCompanyForGrouping,
} from './feedback/feedback-analyzer';

