/**
 * Feedback Loop & Pattern Synthesis Engine (HITL Slice 4)
 * Location: scraper/src/feedback/feedback-analyzer.ts
 *
 * Responsibilities:
 * 1. Analyzes historical rejections in Notion Evaluation Log.
 * 2. Detects patterns when 3+ rejections share the same employer or technology keyword.
 * 3. Synthesizes draft rules for Notion Matching Criteria & Guardrails (Active: false).
 * 4. Generates Telegram proposal messages with 1-click activation inline keyboard.
 */

import { TelegramInlineKeyboardMarkup } from '../utils/telegram';

export interface EvaluationLogRecord {
  readonly id: string;
  readonly title: string;
  readonly company: string;
  readonly url?: string;
  readonly tags?: string[];
  readonly humanVerdict?: string;
  readonly reasonCode?: string;
  readonly rejectReason?: string;
  readonly notes?: string;
}

export interface SynthesizedRuleDraft {
  readonly ruleName: string;
  readonly category: 'Hard Reject (Red Flag)' | 'Salary & Contract' | 'Location & Work Style';
  readonly enforcement: 'Hard Gate (Code + Prompt)';
  readonly ruleType: 'Force Reject (Score = 0)';
  readonly valueKeywords: string;
  readonly ruleDescription: string;
  readonly active: false;
  readonly occurrences: number;
  readonly patternKey: string;
  readonly sampleVacancies: string[];
}

export interface RuleProposalMessage {
  readonly textHtml: string;
  readonly keyboard: TelegramInlineKeyboardMarkup;
}

/**
 * Normalizes company name for pattern grouping (lowercase, trim, strip legal designations).
 */
export function normalizeCompanyForGrouping(company: string): string {
  if (!company) return '';
  const noDots = company.toLowerCase().replace(/[.,/\\#]/g, ' ');
  return noDots
    .replace(/\b(sp\s*z\s*o\s*o|spółka\s+z\s+o\s*o|s\s*a|inc|ltd|gmbh|llc)\b/gi, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Analyzes evaluation log records to detect repeated rejection patterns.
 * When 3+ vacancies match a company or specific rejection reason, synthesizes a guardrail rule.
 */
export function analyzeFeedbackPatterns(
  records: readonly EvaluationLogRecord[],
  threshold = 3
): SynthesizedRuleDraft[] {
  const rejectedRecords = records.filter(
    (r) =>
      r.humanVerdict === 'Wrong – Should Reject' ||
      Boolean(r.reasonCode) ||
      Boolean(r.rejectReason)
  );

  const companyGroups = new Map<string, EvaluationLogRecord[]>();
  const reasonTechGroups = new Map<string, EvaluationLogRecord[]>();

  for (const record of rejectedRecords) {
    // 1. Group by Company
    const compKey = normalizeCompanyForGrouping(record.company);
    if (compKey.length >= 2) {
      const list = companyGroups.get(compKey) || [];
      list.push(record);
      companyGroups.set(compKey, list);
    }

    // 2. Group by Rejection Code & Associated Tech Tags
    const rCode = record.reasonCode || 'gen';
    if (record.tags && record.tags.length > 0) {
      for (const tag of record.tags) {
        const cleanTag = tag.trim().toLowerCase();
        if (cleanTag.length >= 2) {
          const key = `${rCode}:${cleanTag}`;
          const list = reasonTechGroups.get(key) || [];
          list.push(record);
          reasonTechGroups.set(key, list);
        }
      }
    }
  }

  const synthesized: SynthesizedRuleDraft[] = [];

  // Evaluate Company Patterns
  for (const [compKey, items] of companyGroups.entries()) {
    if (items.length >= threshold) {
      const canonicalName = items[0].company;
      synthesized.push({
        ruleName: `Auto-Guardrail: Block ${canonicalName}`,
        category: 'Hard Reject (Red Flag)',
        enforcement: 'Hard Gate (Code + Prompt)',
        ruleType: 'Force Reject (Score = 0)',
        valueKeywords: canonicalName,
        ruleDescription: `Auto-generated rule: candidate rejected ${items.length} vacancies from ${canonicalName}. Automatically reject and set overall score to 0.`,
        active: false,
        occurrences: items.length,
        patternKey: `company:${compKey}`,
        sampleVacancies: items.map((i) => `${i.title} @ ${i.company}`),
      });
    }
  }

  // Evaluate Reason + Technology Patterns
  for (const [key, items] of reasonTechGroups.entries()) {
    if (items.length >= threshold) {
      const [rCode, tag] = key.split(':');
      let category: SynthesizedRuleDraft['category'] = 'Hard Reject (Red Flag)';
      if (rCode === 'sal') category = 'Salary & Contract';
      if (rCode === 'loc') category = 'Location & Work Style';

      synthesized.push({
        ruleName: `Auto-Guardrail: Filter [${tag.toUpperCase()}] (${rCode})`,
        category,
        enforcement: 'Hard Gate (Code + Prompt)',
        ruleType: 'Force Reject (Score = 0)',
        valueKeywords: tag,
        ruleDescription: `Auto-generated rule: candidate rejected ${items.length} vacancies tagged with [${tag}] (reason: ${rCode}).`,
        active: false,
        occurrences: items.length,
        patternKey: key,
        sampleVacancies: items.map((i) => `${i.title} @ ${i.company}`),
      });
    }
  }

  return synthesized;
}

/**
 * Formats a Telegram proposal message with an inline button to activate the synthesized rule in 1 click.
 */
export function formatRuleActivationProposal(rule: SynthesizedRuleDraft): RuleProposalMessage {
  const safeSlug = rule.patternKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);

  const textHtml = [
    '💡 <b>Обнаружен повторяющийся паттерн отказов (3+ раза):</b>',
    '',
    `📌 <b>Правило:</b> <code>${rule.ruleName}</code>`,
    `🏢 <b>Ключевое значение:</b> <code>${rule.valueKeywords}</code>`,
    `📊 <b>Количество отказов:</b> ${rule.occurrences}`,
    '',
    '📝 <b>Примеры вакансий:</b>',
    ...rule.sampleVacancies.slice(0, 3).map((v) => `• ${v}`),
    '',
    'Создать и активировать постоянное правило фильтрации в Notion?',
  ].join('\n');

  const keyboard: TelegramInlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: '✅ Активировать в Notion', callback_data: `act:${safeSlug}` },
        { text: '❌ Игнорировать', callback_data: `ign:${safeSlug}` },
      ],
    ],
  };

  return { textHtml, keyboard };
}
