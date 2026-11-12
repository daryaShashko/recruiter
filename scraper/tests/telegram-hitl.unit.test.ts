import {
  buildDismissedKeyboard,
  buildNotionStatusUpdatePayload,
  buildPromotedKeyboard,
  buildTopic2HotMatchKeyboard,
  buildTopic3ReviewKeyboard,
  compactNotionPageId,
  encodeCallback,
  escapeHtml,
  formatTelegramAlertMessage,
  parseCallbackData,
} from '../src/utils/telegram';

describe('Telegram HITL Protocol & Keyboard Builders (Slice 2)', () => {
  const sampleUuid = '36c747f7-ebec-80c8-bfd7-ed317f4a7c35';
  const sampleCompactId = '36c747f7ebec80c8bfd7ed317f4a7c35';

  describe('compactNotionPageId', () => {
    it('strips hyphens and converts to lowercase', () => {
      expect(compactNotionPageId(sampleUuid)).toBe(sampleCompactId);
      expect(compactNotionPageId('12345678-ABCD-EF01-2345-6789ABCDEF01')).toBe(
        '12345678abcdef0123456789abcdef01',
      );
    });

    it('handles non-string inputs safely', () => {
      expect(compactNotionPageId('' as unknown as string)).toBe('');
      expect(compactNotionPageId(null as unknown as string)).toBe('');
      expect(compactNotionPageId(undefined as unknown as string)).toBe('');
    });
  });

  describe('encodeCallback and parseCallbackData', () => {
    it('encodes promote callback strictly within 64 bytes', () => {
      const cb = encodeCallback('prm', sampleUuid);
      expect(cb).toBe(`prm:${sampleCompactId}`);
      expect(Buffer.byteLength(cb, 'utf8')).toBe(36);
      expect(Buffer.byteLength(cb, 'utf8')).toBeLessThanOrEqual(64);

      const parsed = parseCallbackData(cb);
      expect(parsed).toEqual({
        action: 'prm',
        pageId: sampleCompactId,
      });
    });

    it('encodes discard callback strictly within 64 bytes', () => {
      const cb = encodeCallback('dsc', sampleUuid);
      expect(cb).toBe(`dsc:${sampleCompactId}`);
      expect(Buffer.byteLength(cb, 'utf8')).toBe(36);

      const parsed = parseCallbackData(cb);
      expect(parsed).toEqual({
        action: 'dsc',
        pageId: sampleCompactId,
      });
    });

    it('encodes apply and reject callbacks correctly', () => {
      const appCb = encodeCallback('app', sampleCompactId);
      expect(appCb).toBe(`app:${sampleCompactId}`);
      expect(parseCallbackData(appCb)).toEqual({
        action: 'app',
        pageId: sampleCompactId,
      });

      const rejCb = encodeCallback('rej', sampleCompactId);
      expect(rejCb).toBe(`rej:${sampleCompactId}`);
      expect(parseCallbackData(rejCb)).toEqual({
        action: 'rej',
        pageId: sampleCompactId,
      });
    });

    it('encodes feedback reason code callback correctly', () => {
      const rfbCb = encodeCallback('rfb', sampleCompactId, 'sal');
      expect(rfbCb).toBe(`rfb:sal:${sampleCompactId}`);
      expect(Buffer.byteLength(rfbCb, 'utf8')).toBeLessThanOrEqual(64);

      const parsed = parseCallbackData(rfbCb);
      expect(parsed).toEqual({
        action: 'rfb',
        pageId: sampleCompactId,
        reasonCode: 'sal',
      });
    });

    it('throws error when page id is empty or non-hex', () => {
      expect(() => encodeCallback('prm', 'invalid-non-hex-id-zzzz')).toThrow();
    });

    it('returns null on invalid or oversized callback data', () => {
      expect(parseCallbackData(null)).toBeNull();
      expect(parseCallbackData('')).toBeNull();
      expect(parseCallbackData('unknown_action:12345')).toBeNull();
      expect(parseCallbackData(`prm:${'a'.repeat(65)}`)).toBeNull();
      expect(parseCallbackData('prm:short')).toBeNull(); // not 32 chars
    });
  });

  describe('Keyboards Generation', () => {
    const jobUrl = 'https://justjoin.it/offers/senior-fullstack-dev';

    it('builds Topic 3 review keyboard with required buttons', () => {
      const kb = buildTopic3ReviewKeyboard(sampleUuid, jobUrl);
      expect(kb.inline_keyboard).toHaveLength(2);

      // Row 1: [ 👍 Берём в Hot Match ] and [ 👎 В архив ]
      expect(kb.inline_keyboard[0]).toHaveLength(2);
      expect(kb.inline_keyboard[0][0].text).toContain('👍 Берём в Hot Match');
      expect(kb.inline_keyboard[0][0].callback_data).toBe(`prm:${sampleCompactId}`);
      expect(kb.inline_keyboard[0][1].text).toContain('👎 В архив');
      expect(kb.inline_keyboard[0][1].callback_data).toBe(`dsc:${sampleCompactId}`);

      // Row 2: [ 🔗 Вакансия ]
      expect(kb.inline_keyboard[1]).toHaveLength(1);
      expect(kb.inline_keyboard[1][0].text).toContain('🔗 Вакансия');
      expect(kb.inline_keyboard[1][0].url).toBe(jobUrl);
    });

    it('builds Topic 2 Hot Match keyboard with command post buttons', () => {
      const kb = buildTopic2HotMatchKeyboard(sampleUuid, jobUrl);
      expect(kb.inline_keyboard).toHaveLength(2);

      // Row 1: [ 🚀 Подготовить отклик ]
      expect(kb.inline_keyboard[0]).toHaveLength(1);
      expect(kb.inline_keyboard[0][0].text).toContain('🚀 Подготовить отклик');
      expect(kb.inline_keyboard[0][0].callback_data).toBe(`app:${sampleCompactId}`);

      // Row 2: [ 🔗 Вакансия ] and [ 👎 В архив ]
      expect(kb.inline_keyboard[1]).toHaveLength(2);
      expect(kb.inline_keyboard[1][0].text).toContain('🔗 Вакансия');
      expect(kb.inline_keyboard[1][0].url).toBe(jobUrl);
      expect(kb.inline_keyboard[1][1].text).toContain('👎 В архив');
      expect(kb.inline_keyboard[1][1].callback_data).toBe(`rej:${sampleCompactId}`);
    });

    it('builds status replacement keyboards', () => {
      const promoted = buildPromotedKeyboard();
      expect(promoted.inline_keyboard[0][0].text).toBe('✅ Перенесено в Горячий мэтч');

      const dismissed = buildDismissedKeyboard();
      expect(dismissed.inline_keyboard[0][0].text).toBe('❌ Отклонено пользователем');
    });
  });

  describe('formatTelegramAlertMessage', () => {
    it('formats Hot Match alert with company dossier and direct URL', () => {
      const msg = formatTelegramAlertMessage({
        title: 'Senior TypeScript Engineer',
        company: 'FinTech Sp. z o.o.',
        salary: '25 000 - 30 000 PLN',
        location: 'Remote',
        source: 'justjoin',
        url: 'https://justjoin.it/offers/senior-ts',
        overall_score: 85,
        tech_stack_match: 90,
        seniority_match: 80,
        reason: 'Strong match for TypeScript and architectural leadership.',
        company_dossier: 'B2B FinTech платформа платежей для европейских банков.',
        companyUrl: 'https://fintech.example.com',
        isHotMatch: true,
      });

      expect(msg).toContain('🔥 <b>[Горячий мэтч] Senior TypeScript Engineer</b> @ <b>FinTech Sp. z o.o.</b>');
      expect(msg).toContain('🏢 <b>О компании:</b>');
      expect(msg).toContain('B2B FinTech платформа платежей для европейских банков.');
      expect(msg).toContain('<a href="https://fintech.example.com">🌐 Сайт компании</a>');
      expect(msg).toContain('🎯 Мэтч: 85/100');
    });

    it('formats Review alert with Google fallback link when companyUrl is missing', () => {
      const msg = formatTelegramAlertMessage({
        title: 'Full Stack Developer',
        company: 'Mystery Startup',
        source: 'nofluffjobs',
        url: 'https://nofluffjobs.com/job/mystery',
        overall_score: 65,
        tech_stack_match: 70,
        seniority_match: 60,
        reason: 'Good stack match, but slightly junior seniority.',
        company_dossier: 'Разработка SaaS платформы для e-commerce.',
        isHotMatch: false,
      });

      expect(msg).toContain('👀 <b>[На ревью] Full Stack Developer</b> @ <b>Mystery Startup</b>');
      expect(msg).toContain('🔍 Найти в Google');
      expect(msg).toContain(encodeURIComponent('Mystery Startup software'));
      expect(msg).toContain('🎯 Мэтч: 65/100');
    });

    it('escapes HTML special characters correctly', () => {
      expect(escapeHtml('<script>alert("xss & fun")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss &amp; fun&quot;)&lt;/script&gt;',
      );
    });
  });

  describe('buildNotionStatusUpdatePayload', () => {
    it('creates Notion page property patch payload', () => {
      const hotMatchPatch = buildNotionStatusUpdatePayload('Hot Match');
      expect(hotMatchPatch).toEqual({
        properties: {
          Status: {
            select: {
              name: 'Hot Match',
            },
          },
        },
      });

      const rejectedPatch = buildNotionStatusUpdatePayload('Rejected');
      expect(rejectedPatch.properties.Status.select.name).toBe('Rejected');
    });
  });
});
