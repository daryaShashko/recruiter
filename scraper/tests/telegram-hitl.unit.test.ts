import {
  buildApplicationDeliveryKeyboard,
  buildDismissedKeyboard,
  buildEvaluationLogFeedbackPatch,
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

    it('encodes apply, applied, and reject callbacks correctly', () => {
      const appCb = encodeCallback('app', sampleCompactId);
      expect(appCb).toBe(`app:${sampleCompactId}`);
      expect(parseCallbackData(appCb)).toEqual({
        action: 'app',
        pageId: sampleCompactId,
      });

      const appliedCb = encodeCallback('applied', sampleUuid);
      expect(appliedCb).toBe(`applied:${sampleCompactId}`);
      expect(Buffer.byteLength(appliedCb, 'utf8')).toBe(40);
      expect(Buffer.byteLength(appliedCb, 'utf8')).toBeLessThanOrEqual(64);
      expect(parseCallbackData(appliedCb)).toEqual({
        action: 'applied',
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

    it('builds Topic 3 review keyboard with direct apply, promote, archive, and url buttons', () => {
      const kb = buildTopic3ReviewKeyboard(sampleUuid, jobUrl);
      expect(kb.inline_keyboard).toHaveLength(3);

      // Row 1: [ 🚀 Подготовить отклик ] (direct apply without intermediate promote)
      expect(kb.inline_keyboard[0]).toHaveLength(1);
      expect(kb.inline_keyboard[0][0].text).toContain('🚀 Подготовить отклик');
      expect(kb.inline_keyboard[0][0].callback_data).toBe(`app:${sampleCompactId}`);

      // Row 2: [ 👍 Берём в Hot Match ] and [ 👎 В архив ] (1-click archive)
      expect(kb.inline_keyboard[1]).toHaveLength(2);
      expect(kb.inline_keyboard[1][0].text).toContain('👍 Берём в Hot Match');
      expect(kb.inline_keyboard[1][0].callback_data).toBe(`prm:${sampleCompactId}`);
      expect(kb.inline_keyboard[1][1].text).toContain('👎 В архив');
      expect(kb.inline_keyboard[1][1].callback_data).toBe(`dsc:${sampleCompactId}`);

      // Row 3: [ 🔗 Вакансия ]
      expect(kb.inline_keyboard[2]).toHaveLength(1);
      expect(kb.inline_keyboard[2][0].text).toContain('🔗 Вакансия');
      expect(kb.inline_keyboard[2][0].url).toBe(jobUrl);
    });

    it('builds Application Delivery keyboard with job form URL and applied confirmation button', () => {
      const kbWithUrl = buildApplicationDeliveryKeyboard(sampleUuid, jobUrl);
      expect(kbWithUrl.inline_keyboard).toHaveLength(2);
      expect(kbWithUrl.inline_keyboard[0][0]).toEqual({
        text: '🔗 Открыть форму вакансии',
        url: jobUrl,
      });
      expect(kbWithUrl.inline_keyboard[1][0]).toEqual({
        text: '✅ Я отправила отклик',
        callback_data: `applied:${sampleCompactId}`,
      });

      const kbWithoutUrl = buildApplicationDeliveryKeyboard(sampleUuid);
      expect(kbWithoutUrl.inline_keyboard).toHaveLength(1);
      expect(kbWithoutUrl.inline_keyboard[0][0]).toEqual({
        text: '✅ Я отправила отклик',
        callback_data: `applied:${sampleCompactId}`,
      });
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

    it('formats approved dry card for Hot Match when detailed fields are present', () => {
      const msg = formatTelegramAlertMessage({
        title: 'Senior Full-Stack Engineer',
        company: 'FinTech Innovations',
        salary: '25 000 – 30 000 PLN B2B',
        net_salary: '20 000 – 24 000 PLN',
        location: '100% Remote / офис в Гданьске (B2B, Польша)',
        source: 'justjoin',
        url: 'https://justjoin.it/offers/fintech-senior-full-stack',
        overall_score: 85,
        project_domain: 'FinTech / B2B Payments (эквайринг и расчетный процессинг)',
        project_summary:
          'SaaS-платформа приема платежей для e-commerce (аналог Stripe): интеграция с банками Европы, маршрутизация транзакций, авто-возвраты и антифрод.',
        project_scale: '400+ онлайн-ритейлеров в ЕС, через систему проходит ~$30M/мес.',
        stack_core: 'Node.js, TypeScript, React, PostgreSQL',
        stack_infra: 'AWS, Docker, Kafka, Redis',
        tasks_summary: [
          'Highload API платёжного шлюза и обработка вебхуков',
          'Микрофронтенды кабинета мерчантов на React',
          'Оптимизация SQL-запросов и отказоустойчивость транзакций',
        ],
        match_pros: [
          '100% твой core-стек (TS, Node, React, Postgres)',
          'Прямой опыт: финтех-модули и лидерство стрима в EPAM',
        ],
        match_cons: [
          'Требуют Kafka (у тебя в опыте RabbitMQ — разница концептуальная, но не блокер)',
        ],
        isHotMatch: true,
      });

      const expected = [
        '🔥 <b>[Горячий мэтч] Senior Full-Stack Engineer</b> @ <b>FinTech Innovations</b>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '💵 25 000 – 30 000 PLN B2B  (на руки ~20 000 – 24 000 PLN)',
        '📍 100% Remote / офис в Гданьске (B2B, Польша)',
        '',
        '📦 <b>Проект и домен:</b>',
        '• Домен: FinTech / B2B Payments (эквайринг и расчетный процессинг)',
        '• Что делает: SaaS-платформа приема платежей для e-commerce (аналог Stripe): интеграция с банками Европы, маршрутизация транзакций, авто-возвраты и антифрод.',
        '• Масштаб/Клиенты: 400+ онлайн-ритейлеров в ЕС, через систему проходит ~$30M/мес.',
        '',
        '⚙️ <b>Стек:</b>',
        '• Core: Node.js, TypeScript, React, PostgreSQL',
        '• Infra: AWS, Docker, Kafka, Redis',
        '',
        '🎯 <b>Задачи:</b>',
        '• Highload API платёжного шлюза и обработка вебхуков',
        '• Микрофронтенды кабинета мерчантов на React',
        '• Оптимизация SQL-запросов и отказоустойчивость транзакций',
        '',
        '⚖️ <b>Мэтч с твоим профилем (85%):</b>',
        '• [+] 100% твой core-стек (TS, Node, React, Postgres)',
        '• [+] Прямой опыт: финтех-модули и лидерство стрима в EPAM',
        '• [−] Требуют Kafka (у тебя в опыте RabbitMQ — разница концептуальная, но не блокер)',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ].join('\n');

      expect(msg).toBe(expected);
    });

    it('formats Review mode (👀 [На ревью]) and handles partial detailed fields gracefully', () => {
      const msg = formatTelegramAlertMessage({
        title: 'Backend Engineer',
        company: 'Cloud Corp',
        location: 'Warsaw Hybrid',
        source: 'nofluffjobs',
        url: 'https://nofluffjobs.com/job/cloud-corp',
        isHotMatch: false,
        project_domain: 'Cloud Infrastructure & Observability',
        company_dossier: 'Разработка облачного SaaS сервиса.',
        stack_core: ['TypeScript', 'Node.js'],
        tasks_summary: ['Разработка REST & gRPC API микросервисов'],
      });

      expect(msg).toContain('👀 <b>[На ревью] Backend Engineer</b> @ <b>Cloud Corp</b>');
      expect(msg).toContain('💵 Зарплата не указана');
      expect(msg).toContain('📍 Warsaw Hybrid');
      expect(msg).toContain('📦 <b>Проект и домен:</b>');
      expect(msg).toContain('• Домен: Cloud Infrastructure &amp; Observability');
      // Falls back to company_dossier when project_summary is missing
      expect(msg).toContain('• Что делает: Разработка облачного SaaS сервиса.');
      expect(msg).not.toContain('• Масштаб/Клиенты:');
      expect(msg).toContain('⚙️ <b>Стек:</b>');
      expect(msg).toContain('• Core: TypeScript, Node.js');
      expect(msg).not.toContain('• Infra:');
      expect(msg).toContain('🎯 <b>Задачи:</b>');
      expect(msg).toContain('• Разработка REST &amp; gRPC API микросервисов');
      expect(msg).not.toContain('⚖️ <b>Мэтч с твоим профилем');
    });

    it('escapes HTML special characters in detailed fields', () => {
      const msg = formatTelegramAlertMessage({
        title: 'Fullstack <Lead> & Architect',
        company: 'R&D "FinTech" Solutions',
        salary: '30 000 <net> PLN',
        location: 'Remote & Hybrid',
        source: 'manual',
        url: 'https://example.com',
        isHotMatch: true,
        project_domain: 'Payments & Risk <AI>',
        project_summary: 'Platform handling >10k req/s & <1% chargebacks',
        tasks_summary: ['Build <secured> API endpoints & hooks'],
        match_pros: ['Experience with <Kafka> & Node'],
        match_cons: ['Missing "Elixir" experience'],
      });

      expect(msg).toContain('Fullstack &lt;Lead&gt; &amp; Architect');
      expect(msg).toContain('R&amp;D &quot;FinTech&quot; Solutions');
      expect(msg).toContain('30 000 &lt;net&gt; PLN');
      expect(msg).toContain('Payments &amp; Risk &lt;AI&gt;');
      expect(msg).toContain('&gt;10k req/s &amp; &lt;1% chargebacks');
      expect(msg).toContain('&lt;secured&gt; API endpoints &amp; hooks');
      expect(msg).toContain('Experience with &lt;Kafka&gt; &amp; Node');
      expect(msg).toContain('&quot;Elixir&quot;');
    });

    it('handles various net_salary formats and pro/con prefix variants', () => {
      const msg1 = formatTelegramAlertMessage({
        title: 'Developer',
        company: 'Dev Co',
        source: 'justjoin',
        url: 'https://example.com',
        salary: '20 000 PLN',
        net_salary: '~16 000 PLN',
        project_domain: 'DevTools',
        match_pros: ['[+] Already prefixed pro', '+ Plus prefixed pro'],
        match_cons: ['[−] Unicode minus prefixed', '[-] ASCII minus prefixed', '- Hyphen prefixed'],
      });

      expect(msg1).toContain('💵 20 000 PLN  (на руки ~16 000 PLN)');
      expect(msg1).toContain('• [+] Already prefixed pro');
      expect(msg1).toContain('• [+] Plus prefixed pro');
      expect(msg1).toContain('• [−] Unicode minus prefixed');
      expect(msg1).toContain('• [−] ASCII minus prefixed');
      expect(msg1).toContain('• [−] Hyphen prefixed');

      const msg2 = formatTelegramAlertMessage({
        title: 'Developer',
        company: 'Dev Co',
        source: 'justjoin',
        url: 'https://example.com',
        salary: '20 000 PLN',
        net_salary: '(на руки ~15 000 PLN)',
        project_domain: 'DevTools',
      });
      expect(msg2).toContain('💵 20 000 PLN  (на руки ~15 000 PLN)');
    });

    it('renders pitch_hook with HTML escaping when provided (WP-2.3)', () => {
      const msg = formatTelegramAlertMessage({
        title: 'Senior Node.js Engineer',
        company: 'PayFlow Sp. z o.o.',
        source: 'justjoin',
        url: 'https://justjoin.it/offers/payflow-senior-node',
        overall_score: 88,
        project_summary: 'Платёжный шлюз для <B2B> мерчантов в ЕС.',
        pitch_hook:
          'Сделай упор на миграцию Java/MySQL -> Node.js/PostgreSQL и лидерство 6 инженеров в FinTech & AI.',
        isHotMatch: true,
      });

      expect(msg).toContain('• Что делает: Платёжный шлюз для &lt;B2B&gt; мерчантов в ЕС.');
      expect(msg).toContain(
        '🪝 <b>Хук для отклика:</b> Сделай упор на миграцию Java/MySQL -&gt; Node.js/PostgreSQL и лидерство 6 инженеров в FinTech &amp; AI.',
      );
    });
  });

  describe('buildNotionStatusUpdatePayload and buildEvaluationLogFeedbackPatch', () => {
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

    it('transitions Notion status to Applied when buildEvaluationLogFeedbackPatch is called with applied (WP-3.2)', () => {
      const appliedPatch = buildEvaluationLogFeedbackPatch('applied');
      expect(appliedPatch.properties.Status).toEqual({
        select: {
          name: 'Applied',
        },
      });
      expect(appliedPatch.properties['Human Verdict']).toEqual({
        select: {
          name: 'Applied',
        },
      });
    });
  });
});
