/**
 * Telegram In-Thread Application Delivery Service (HITL Slice 3)
 * Location: scraper/src/generator/telegram-delivery.ts
 *
 * Responsibilities:
 * 1. Assembles complete application bundle for Telegram Topic 2 reply:
 *    - Base Gold ATS CV PDF (fast delivery < 0.2s)
 *    - Tailored LinkedIn Outreach Pitch (60–80 words, 1-click copy)
 *    - Tailored EU/Poland Cover Letter (130–180 words, 1-click copy)
 * 2. Emits Telegram Bot API payloads for sendDocument + sendMessage.
 * 3. Prepares Notion Status patch: Status -> "Applied".
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CandidateCvData,
  TelegramApplicationPackage,
} from './types';
import { DEFAULT_CANDIDATE_CV_DATA } from './notion-loader';
import { generateCoverLetter, generateLinkedInPitch } from './cover-letter';
import { getBaseCvPdf } from './cv-renderer';
import {
  buildApplicationDeliveryKeyboard,
  compactNotionPageId,
  escapeHtml,
  TelegramInlineKeyboardMarkup,
} from '../utils/telegram';

export interface ApplicationDeliveryOptions {
  pageId: string;
  job: {
    title: string;
    company: string;
    url?: string;
    body?: string;
    tags?: string[];
  };
  cvData?: CandidateCvData;
  pdfPath?: string;
  language?: 'en' | 'pl';
}

/**
 * Builds the complete Application Delivery package for Telegram in-thread fulfillment.
 * Does NOT prematurely transition Notion status to "Applied" — that happens only when
 * the user presses the "✅ Я отправила отклик" (`applied:<pageId>`) button.
 */
export async function buildTelegramApplicationPackage(
  options: ApplicationDeliveryOptions
): Promise<
  Omit<TelegramApplicationPackage, 'notionStatusPatch' | 'telegramMessages'> & {
    telegramMessages: {
      documentCaption: string;
      textMessageHtml: string;
      replyMarkup: TelegramInlineKeyboardMarkup;
    };
    replyMarkup: TelegramInlineKeyboardMarkup;
    notionStatusPatch: null;
  }
> {
  const pageId = compactNotionPageId(options.pageId);
  const data = options.cvData || DEFAULT_CANDIDATE_CV_DATA;
  const company = (options.job.company || 'Company').trim();
  const jobTitle = (options.job.title || 'Senior Software Engineer').trim();

  // 1. Generate LinkedIn Outreach Pitch (60–80 words)
  const pitch = generateLinkedInPitch(data, {
    job: {
      title: jobTitle,
      company,
      body: options.job.body || jobTitle,
      tags: options.job.tags,
    },
    language: options.language,
  });

  // 2. Generate Tailored Cover Letter (130–180 words)
  const coverLetter = generateCoverLetter(data, {
    job: {
      title: jobTitle,
      company,
      body: options.job.body || jobTitle,
      tags: options.job.tags,
    },
    language: options.language,
  });

  // 3. Resolve Base Gold CV PDF
  let effectivePdfPath = options.pdfPath;
  if (!effectivePdfPath || !fs.existsSync(effectivePdfPath)) {
    try {
      const baseCv = await getBaseCvPdf(data);
      effectivePdfPath = baseCv.pdfPath;
    } catch {
      // In tests or mock environments without browser, provide target path
      effectivePdfPath = options.pdfPath || path.resolve(process.cwd(), 'output', 'gold_base_cv.pdf');
    }
  }

  // 4. Format Telegram In-Thread Message HTML & Action Keyboard
  const textMessageHtml = formatTelegramDeliveryHtml(company, jobTitle, pitch.text, coverLetter.text);
  const replyMarkup = buildApplicationDeliveryKeyboard(pageId, options.job.url);

  return {
    pageId,
    company,
    jobTitle,
    pdfPath: effectivePdfPath,
    pitch,
    coverLetter,
    telegramMessages: {
      documentCaption: `📄 Резюме (ATS CV) — ${escapeHtml(company)}: ${escapeHtml(jobTitle)}`,
      textMessageHtml,
      replyMarkup,
    },
    replyMarkup,
    notionStatusPatch: null,
  };
}

/**
 * Formats Telegram HTML message containing copy-ready pitch and cover letter inside <pre><code> blocks.
 */
export function formatTelegramDeliveryHtml(
  company: string,
  title: string,
  pitchText: string,
  coverLetterText: string
): string {
  return [
    `🚀 <b>Пакет отклика готов:</b> <b>${escapeHtml(company)}</b> — ${escapeHtml(title)}`,
    '',
    '💬 <b>LinkedIn Outreach Pitch (кликните для копирования):</b>',
    `<pre><code>${escapeHtml(pitchText)}</code></pre>`,
    '',
    '✉️ <b>Cover Letter (кликните для копирования):</b>',
    `<pre><code>${escapeHtml(coverLetterText)}</code></pre>`,
    '',
    '👇 <i>После отправки нажмите <b>«✅ Я отправила отклик»</b>, чтобы перевести статус в Notion в <b>Applied</b>.</i>',
  ].join('\n');
}
