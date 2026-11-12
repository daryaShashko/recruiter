/**
 * Telegram HITL (Human-in-the-Loop) Utilities and Callback Protocol.
 * Strict compliance with Telegram Bot API (callback_data <= 64 bytes).
 */

export type TelegramActionType = 'prm' | 'dsc' | 'app' | 'rej' | 'rfb';

export interface TelegramCallbackAction {
  readonly action: TelegramActionType;
  readonly pageId: string;
  readonly reasonCode?: string;
}

export interface TelegramInlineKeyboardButton {
  readonly text: string;
  readonly callback_data?: string;
  readonly url?: string;
}

export interface TelegramInlineKeyboardMarkup {
  readonly inline_keyboard: TelegramInlineKeyboardButton[][];
}

/**
 * Normalizes a Notion UUID/ID to a compact 32-character hex string without hyphens.
 */
export function compactNotionPageId(rawId: string): string {
  if (typeof rawId !== 'string') return '';
  return rawId.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
}

/**
 * Encodes an action and Notion page ID into a callback_data string <= 64 bytes.
 */
export function encodeCallback(action: TelegramActionType, rawPageId: string, reasonCode?: string): string {
  const pageId = compactNotionPageId(rawPageId);
  if (!pageId || pageId.length !== 32) {
    throw new Error(`Invalid Notion page ID: must be a 32-character hexadecimal string, got "${pageId}"`);
  }

  let payload: string;
  if (action === 'rfb') {
    const code = (reasonCode || 'gen').slice(0, 4);
    payload = `rfb:${code}:${pageId}`;
  } else {
    payload = `${action}:${pageId}`;
  }

  const byteLength = Buffer.byteLength(payload, 'utf8');
  if (byteLength > 64) {
    throw new Error(`callback_data exceeds Telegram 64-byte limit: "${payload}" (${byteLength} bytes)`);
  }

  return payload;
}

/**
 * Parses and validates incoming callback_data from Telegram.
 */
export function parseCallbackData(data?: string | null): TelegramCallbackAction | null {
  if (typeof data !== 'string') return null;
  const trimmed = data.trim();
  if (!trimmed || Buffer.byteLength(trimmed, 'utf8') > 64) return null;

  const parts = trimmed.split(':');
  if (parts.length < 2) return null;

  const action = parts[0] as TelegramActionType;
  if (!['prm', 'dsc', 'app', 'rej', 'rfb'].includes(action)) {
    return null;
  }

  if (action === 'rfb') {
    if (parts.length < 3) return null;
    const reasonCode = parts[1];
    const pageId = compactNotionPageId(parts[2]);
    if (!pageId || pageId.length !== 32) return null;
    return { action, pageId, reasonCode };
  }

  const pageId = compactNotionPageId(parts[1]);
  if (!pageId || pageId.length !== 32) return null;

  return { action, pageId };
}

/**
 * Builds the inline keyboard for Topic 3 («На ревью»).
 * Buttons:
 * Row 1: [ 👍 Берём в Hot Match ] (prm:id) | [ 👎 В архив ] (dsc:id)
 * Row 2: [ 🔗 Вакансия ] (url)
 */
export function buildTopic3ReviewKeyboard(notionPageId: string, jobUrl: string): TelegramInlineKeyboardMarkup {
  const prmCallback = encodeCallback('prm', notionPageId);
  const dscCallback = encodeCallback('dsc', notionPageId);

  return {
    inline_keyboard: [
      [
        { text: '👍 Берём в Hot Match', callback_data: prmCallback },
        { text: '👎 В архив', callback_data: dscCallback },
      ],
      [
        { text: '🔗 Вакансия', url: jobUrl },
      ],
    ],
  };
}

/**
 * Builds the inline keyboard for Topic 2 («Горячий мэтч»).
 * Buttons:
 * Row 1: [ 🚀 Подготовить отклик ] (app:id)
 * Row 2: [ 🔗 Вакансия ] (url) | [ 👎 В архив ] (rej:id)
 */
export function buildTopic2HotMatchKeyboard(notionPageId: string, jobUrl: string): TelegramInlineKeyboardMarkup {
  const appCallback = encodeCallback('app', notionPageId);
  const rejCallback = encodeCallback('rej', notionPageId);

  return {
    inline_keyboard: [
      [
        { text: '🚀 Подготовить отклик', callback_data: appCallback },
      ],
      [
        { text: '🔗 Вакансия', url: jobUrl },
        { text: '👎 В архив', callback_data: rejCallback },
      ],
    ],
  };
}

/**
 * Builds keyboard markup indicating the vacancy was promoted from Topic 3.
 */
export function buildPromotedKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '✅ Перенесено в Горячий мэтч', callback_data: 'noop:promoted' }],
    ],
  };
}

/**
 * Builds keyboard markup indicating the vacancy was discarded/rejected.
 */
export function buildDismissedKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '❌ Отклонено пользователем', callback_data: 'noop:dismissed' }],
    ],
  };
}

/**
 * Standard Rejection Reason tags (Slice 4).
 */
export const REJECT_REASONS = {
  sal: { code: 'sal', label: '💸 Зарплата', description: 'Зарплата ниже ожиданий' },
  out: { code: 'out', label: '🏢 Аутсорс', description: 'Аутсорсинг / агентство' },
  leg: { code: 'leg', label: '💀 Легаси', description: 'Устаревший стек / поддержка легаси' },
  loc: { code: 'loc', label: '📍 Локация', description: 'Неподходящая локация / офис' },
  jun: { code: 'jun', label: '📉 Грейд', description: 'Несоответствие сеньорности' },
} as const;

export type RejectReasonCode = keyof typeof REJECT_REASONS;

/**
 * Builds the inline keyboard for Topic 2 Reject Reasons Menu (Slice 4).
 * Buttons:
 * Row 1: [ 💸 Зарплата ] (rfb:sal:id) | [ 🏢 Аутсорс ] (rfb:out:id)
 * Row 2: [ 💀 Легаси ] (rfb:leg:id)  | [ 📍 Локация ] (rfb:loc:id)
 * Row 3: [ 📉 Грейд ] (rfb:jun:id)   | [ ❌ Без причины ] (dsc:id)
 */
export function buildTopic2RejectReasonsKeyboard(notionPageId: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: REJECT_REASONS.sal.label, callback_data: encodeCallback('rfb', notionPageId, 'sal') },
        { text: REJECT_REASONS.out.label, callback_data: encodeCallback('rfb', notionPageId, 'out') },
      ],
      [
        { text: REJECT_REASONS.leg.label, callback_data: encodeCallback('rfb', notionPageId, 'leg') },
        { text: REJECT_REASONS.loc.label, callback_data: encodeCallback('rfb', notionPageId, 'loc') },
      ],
      [
        { text: REJECT_REASONS.jun.label, callback_data: encodeCallback('rfb', notionPageId, 'jun') },
        { text: '❌ Без причины', callback_data: encodeCallback('dsc', notionPageId) },
      ],
    ],
  };
}

/**
 * Builds keyboard markup indicating the vacancy was rejected with a specific reason.
 */
export function buildRejectReasonConfirmationKeyboard(reasonCode?: string): TelegramInlineKeyboardMarkup {
  const code = reasonCode as RejectReasonCode;
  const label = (code && REJECT_REASONS[code]) ? REJECT_REASONS[code].label : 'В архив';
  return {
    inline_keyboard: [
      [{ text: `❌ Отклонено: ${label}`, callback_data: 'noop:rejected' }],
    ],
  };
}

/**
 * Builds Notion API payload to update an Evaluation Log row with human verdict.
 */
export function buildEvaluationLogFeedbackPatch(
  reasonCode?: string,
  userComment?: string
): {
  properties: {
    'Human Verdict': { select: { name: 'Wrong – Should Reject' } };
    Reason?: { rich_text: Array<{ text: { content: string } }> };
  };
} {
  const code = reasonCode as RejectReasonCode;
  const reasonLabel = (code && REJECT_REASONS[code]) ? REJECT_REASONS[code].label : 'Manual Reject';
  const fullText = userComment ? `${reasonLabel}: ${userComment}` : reasonLabel;

  return {
    properties: {
      'Human Verdict': {
        select: {
          name: 'Wrong – Should Reject',
        },
      },
      Reason: {
        rich_text: [
          {
            text: {
              content: fullText,
            },
          },
        ],
      },
    },
  };
}

export interface TelegramAlertJobInput {
  readonly title: string;
  readonly company: string;
  readonly location?: string;
  readonly salary?: string;
  readonly source: string;
  readonly url: string;
  readonly overall_score?: number;
  readonly tech_stack_match?: number;
  readonly seniority_match?: number;
  readonly reason?: string;
  readonly company_dossier?: string;
  readonly companyUrl?: string;
  readonly isHotMatch?: boolean;
}

/**
 * Formats a Telegram HTML message with company dossier and links.
 */
export function formatTelegramAlertMessage(job: TelegramAlertJobInput): string {
  const icon = job.isHotMatch ? '🔥' : '👀';
  const prefix = job.isHotMatch ? 'Горячий мэтч' : 'На ревью';

  const companyLink = job.companyUrl
    ? `<a href="${job.companyUrl}">🌐 Сайт компании</a>`
    : `<a href="https://www.google.com/search?q=${encodeURIComponent(job.company + ' software')}">🔍 Найти в Google</a>`;

  const dossierText = job.company_dossier
    ? job.company_dossier.trim()
    : 'Информация о компании уточняется.';

  const salaryText = job.salary ? job.salary : 'Зарплата не указана';
  const locationText = job.location ? job.location : 'Локация не указана';
  const scoreText = job.overall_score !== undefined
    ? `🎯 Мэтч: ${job.overall_score}/100 (Стек: ${job.tech_stack_match ?? '-'}, Сеньорность: ${job.seniority_match ?? '-'})`
    : '';
  const reasonText = job.reason ? `💡 ${job.reason}` : '';

  const lines = [
    `${icon} <b>[${prefix}] ${escapeHtml(job.title)}</b> @ <b>${escapeHtml(job.company)}</b>`,
    `💰 ${escapeHtml(salaryText)} | 📍 ${escapeHtml(locationText)} | 🌐 ${escapeHtml(job.source)}`,
    `🔗 <a href="${job.url}">Вакансия</a>`,
    '',
    '🏢 <b>О компании:</b>',
    `${escapeHtml(dossierText)}`,
    `${companyLink}`,
  ];

  if (scoreText) {
    lines.push('');
    lines.push(scoreText);
  }
  if (reasonText) {
    lines.push(escapeHtml(reasonText));
  }

  return lines.join('\n');
}

/**
 * Escapes characters for Telegram HTML mode.
 */
export function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds Notion API payload to update a page Status.
 */
export function buildNotionStatusUpdatePayload(status: 'Hot Match' | 'Review' | 'Applied' | 'Rejected'): {
  properties: { Status: { select: { name: string } } };
} {
  return {
    properties: {
      Status: {
        select: {
          name: status,
        },
      },
    },
  };
}
