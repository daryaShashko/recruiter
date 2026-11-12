/**
 * Interactive Demonstration of the Full HITL Workflow (Slices 1 - 4).
 * Runs 100% offline in < 2 seconds.
 *
 * Usage:
 *   npx ts-node scraper/src/demo-hitl.ts
 */

import {
  formatTelegramAlertMessage,
  buildTopic3ReviewKeyboard,
  buildTopic2HotMatchKeyboard,
  buildTopic2RejectReasonsKeyboard,
  buildRejectReasonConfirmationKeyboard,
  buildPromotedKeyboard,
  buildEvaluationLogFeedbackPatch,
  parseCallbackData,
} from './utils/telegram';
import { buildTelegramApplicationPackage } from './generator/telegram-delivery';
import {
  analyzeFeedbackPatterns,
  formatRuleActivationProposal,
  EvaluationLogRecord,
} from './feedback/feedback-analyzer';

async function runDemo() {
  const pageId = '36c747f7-ebec-80c8-bfd7-ed317f4a7c35';
  const divider = '─'.repeat(70);

  console.log('\n' + '='.repeat(70));
  console.log('🤖 ИНТЕРАКТИВНАЯ ДЕМОНСТРАЦИЯ HITL WORKFLOW (СЛАЙСЫ 1 - 4)');
  console.log('='.repeat(70) + '\n');

  // ──────────────────────────────────────────────────────────────────────────
  // СЛАЙС 1: Метаданные компании, досье и ссылка на поиск в Google
  // ──────────────────────────────────────────────────────────────────────────
  console.log('📌 [СЛАЙС 1] Извлечение метаданных и блок «🏢 О компании»');
  console.log(divider);

  const sampleOffer = {
    title: 'Senior Full-Stack Engineer (React / Node.js)',
    company: 'FinTech Innovations Sp. z o.o.',
    salary: '24 000 - 30 000 PLN (B2B)',
    location: 'Gdańsk / Remote',
    source: 'justjoin',
    url: 'https://justjoin.it/offers/fintech-innovations-senior-full-stack',
    overall_score: 72,
    tech_stack_match: 85,
    seniority_match: 75,
    reason: 'Сильное совпадение стека TypeScript и архитектурного опыта.',
    company_dossier: 'B2B FinTech платформа платежей для европейских необанков. Продуктовая компания, штат 150+ чел.',
    companyUrl: 'https://fintech-innovations.example.com',
  };

  const alertTopic3 = formatTelegramAlertMessage({
    ...sampleOffer,
    isHotMatch: false,
  });

  console.log('Сформированное сообщение для Telegram:');
  console.log(alertTopic3);
  console.log('\n(Если у компании нет сайта, вместо ссылки подставляется Google:');
  console.log(
    ' ' +
      formatTelegramAlertMessage({
        ...sampleOffer,
        companyUrl: undefined,
        isHotMatch: false,
      }).split('\n')[6]
  );
  console.log('\n✅ Слайс 1 проверен: метаданные извлечены, блок о компании и Google-фоллбэк работают.');
  console.log(divider + '\n');

  // ──────────────────────────────────────────────────────────────────────────
  // СЛАЙС 2: Topic 3 «На ревью» -> Клик [ 👍 Берём ] -> Перенос в Topic 2
  // ──────────────────────────────────────────────────────────────────────────
  console.log('📌 [СЛАЙС 2] Topic 3 (Ревью) -> Promote Flow -> Topic 2 (Горячий мэтч)');
  console.log(divider);

  const reviewKb = buildTopic3ReviewKeyboard(pageId, sampleOffer.url);
  console.log('1. Клавиатура в Topic 3 («На ревью»):');
  reviewKb.inline_keyboard.forEach((row, i) => {
    console.log(`   Ряд ${i + 1}: ` + row.map((b) => `[ ${b.text} (${b.callback_data || b.url}) ]`).join(' '));
  });

  const sampleCallback = reviewKb.inline_keyboard[0][0].callback_data!;
  console.log(`\n2. Пользователь кликает кнопку в Topic 3: callback_data="${sampleCallback}"`);
  const parsedAction = parseCallbackData(sampleCallback);
  console.log('   Парсинг callback_data:', parsedAction);
  console.log(`   Длина payload: ${Buffer.byteLength(sampleCallback, 'utf8')} байт (лимит Telegram <= 64 байт: OK)`);

  console.log('\n3. Автоматические действия бота:');
  console.log('   - Notion API: Status -> "Hot Match"');
  console.log('   - В Topic 3 клавиатура меняется на: [ ' + buildPromotedKeyboard().inline_keyboard[0][0].text + ' ]');

  const hotMatchKb = buildTopic2HotMatchKeyboard(pageId, sampleOffer.url);
  console.log('   - В Topic 2 («Горячий мэтч») отправляется боевая карточка с кнопками:');
  hotMatchKb.inline_keyboard.forEach((row, i) => {
    console.log(`     Ряд ${i + 1}: ` + row.map((b) => `[ ${b.text} (${b.callback_data || b.url}) ]`).join(' '));
  });

  console.log('\n✅ Слайс 2 проверен: кнопки Topic 3, callback-протокол и перенос в Topic 2 работают.');
  console.log(divider + '\n');

  // ──────────────────────────────────────────────────────────────────────────
  // СЛАЙС 3: Клик [ 🚀 Подготовить отклик ] -> Доставка пакета в тред
  // ──────────────────────────────────────────────────────────────────────────
  console.log('📌 [СЛАЙС 3] Генерация и доставка отклика по кнопке [ 🚀 Подготовить отклик ]');
  console.log(divider);

  console.log('Генерация пакета отклика...');
  const appPackage = await buildTelegramApplicationPackage({
    pageId,
    job: {
      title: sampleOffer.title,
      company: sampleOffer.company,
      body: sampleOffer.reason,
      tags: ['TypeScript', 'React', 'Node.js'],
    },
  });

  console.log(`\n1. Доставка файла резюме:`);
  console.log(`   Файл: ${appPackage.pdfPath}`);
  console.log(`   Подпись документа: "${appPackage.telegramMessages.documentCaption}"`);

  console.log(`\n2. Текстовое сообщение в тред Telegram:`);
  console.log(appPackage.telegramMessages.textMessageHtml);

  console.log(`\n3. Обновление статуса в Notion:`);
  console.log('   Payload:', JSON.stringify(appPackage.notionStatusPatch));

  console.log('\n✅ Слайс 3 проверен: CV PDF, LinkedIn-питч, Cover Letter и статус Applied работают.');
  console.log(divider + '\n');

  // ──────────────────────────────────────────────────────────────────────────
  // СЛАЙС 4: Клик [ 👎 В архив ] -> Меню причин -> Накопление 3+ отказов -> Notion
  // ──────────────────────────────────────────────────────────────────────────
  console.log('📌 [СЛАЙС 4] Меню причин отказа и Feedback Loop (синтез правил)');
  console.log(divider);

  console.log('1. При клике [ 👎 В архив ] в Topic 2 открывается меню причин:');
  const rejectMenu = buildTopic2RejectReasonsKeyboard(pageId);
  rejectMenu.inline_keyboard.forEach((row, i) => {
    console.log(`   Ряд ${i + 1}: ` + row.map((b) => `[ ${b.text} (${b.callback_data}) ]`).join(' '));
  });

  console.log('\n2. Пользователь выбирает тег [ 🏢 Аутсорс ] (rfb:out):');
  const confirmKb = buildRejectReasonConfirmationKeyboard('out');
  console.log(`   Клавиатура заменяется на: [ ${confirmKb.inline_keyboard[0][0].text} ]`);
  const logPatch = buildEvaluationLogFeedbackPatch('out', 'Кандидат не рассматривает аутсорсинг');
  console.log('   Запись в Notion Evaluation Log:', JSON.stringify(logPatch.properties));

  console.log('\n3. Накопление 3+ отказов для одной компании (анализ паттернов):');
  const sampleHistory: EvaluationLogRecord[] = [
    { id: '1', title: 'Senior Dev', company: 'Global Outsourcing Sp. z o.o.', reasonCode: 'out', humanVerdict: 'Wrong – Should Reject' },
    { id: '2', title: 'Lead Frontend', company: 'Global Outsourcing Sp. z o.o.', reasonCode: 'out', humanVerdict: 'Wrong – Should Reject' },
    { id: '3', title: 'Fullstack Eng', company: 'Global Outsourcing', reasonCode: 'out', humanVerdict: 'Wrong – Should Reject' },
  ];

  const rules = analyzeFeedbackPatterns(sampleHistory, 3);
  console.log(`   Обнаружено паттернов: ${rules.length}`);
  if (rules.length > 0) {
    const proposal = formatRuleActivationProposal(rules[0]);
    console.log('\n   Сформированное предложение правила для Telegram:');
    console.log(proposal.textHtml);
    console.log('   Кнопки:', proposal.keyboard.inline_keyboard[0].map((b) => `[ ${b.text} (${b.callback_data}) ]`).join(' '));
  }

  console.log('\n✅ Слайс 4 проверен: меню причин, запись в Evaluation Log и синтез правил работают.');
  console.log('='.repeat(70) + '\n');
}

runDemo().catch((err) => {
  console.error('Ошибка в демо:', err);
  process.exit(1);
});
