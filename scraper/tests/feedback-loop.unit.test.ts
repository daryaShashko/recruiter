import {
  REJECT_REASONS,
  buildTopic2RejectReasonsKeyboard,
  buildRejectReasonConfirmationKeyboard,
  buildEvaluationLogFeedbackPatch,
} from '../src/utils/telegram';
import {
  analyzeFeedbackPatterns,
  formatRuleActivationProposal,
  normalizeCompanyForGrouping,
  EvaluationLogRecord,
} from '../src/feedback/feedback-analyzer';

describe('Telegram Feedback Loop & Pattern Synthesis (Slice 4)', () => {
  const samplePageId = '36c747f7-ebec-80c8-bfd7-ed317f4a7c35';
  const compactId = '36c747f7ebec80c8bfd7ed317f4a7c35';

  describe('Topic 2 Reject Reasons Keyboard', () => {
    it('builds 3-row menu with standard rejection tags and dsc fallback', () => {
      const kb = buildTopic2RejectReasonsKeyboard(samplePageId);
      expect(kb.inline_keyboard).toHaveLength(3);

      // Row 1: 💸 Зарплата and 🏢 Аутсорс
      expect(kb.inline_keyboard[0][0].text).toBe(REJECT_REASONS.sal.label);
      expect(kb.inline_keyboard[0][0].callback_data).toBe(`rfb:sal:${compactId}`);
      expect(kb.inline_keyboard[0][1].text).toBe(REJECT_REASONS.out.label);
      expect(kb.inline_keyboard[0][1].callback_data).toBe(`rfb:out:${compactId}`);

      // Row 2: 💀 Легаси and 📍 Локация
      expect(kb.inline_keyboard[1][0].text).toBe(REJECT_REASONS.leg.label);
      expect(kb.inline_keyboard[1][0].callback_data).toBe(`rfb:leg:${compactId}`);
      expect(kb.inline_keyboard[1][1].text).toBe(REJECT_REASONS.loc.label);
      expect(kb.inline_keyboard[1][1].callback_data).toBe(`rfb:loc:${compactId}`);

      // Row 3: 📉 Грейд and ❌ Без причины
      expect(kb.inline_keyboard[2][0].text).toBe(REJECT_REASONS.jun.label);
      expect(kb.inline_keyboard[2][0].callback_data).toBe(`rfb:jun:${compactId}`);
      expect(kb.inline_keyboard[2][1].text).toBe('❌ Без причины');
      expect(kb.inline_keyboard[2][1].callback_data).toBe(`dsc:${compactId}`);
    });

    it('builds confirmation keyboard with chosen label', () => {
      const kb = buildRejectReasonConfirmationKeyboard('out');
      expect(kb.inline_keyboard[0][0].text).toBe('❌ Отклонено: 🏢 Аутсорс');

      const fallback = buildRejectReasonConfirmationKeyboard();
      expect(fallback.inline_keyboard[0][0].text).toBe('❌ Отклонено: В архив');
    });
  });

  describe('buildEvaluationLogFeedbackPatch', () => {
    it('creates Notion patch payload with Human Verdict and reason', () => {
      const patch = buildEvaluationLogFeedbackPatch('sal');
      expect(patch.properties['Human Verdict'].select.name).toBe('Wrong – Should Reject');
      expect(patch.properties.Reason?.rich_text[0].text.content).toBe('💸 Зарплата');
    });

    it('appends user textual comment when provided', () => {
      const patch = buildEvaluationLogFeedbackPatch('loc', 'Only remote accepted, no hybrid in Warsaw');
      expect(patch.properties.Reason?.rich_text[0].text.content).toBe(
        '📍 Локация: Only remote accepted, no hybrid in Warsaw'
      );
    });
  });

  describe('normalizeCompanyForGrouping', () => {
    it('strips Polish and international legal forms and punctuation', () => {
      expect(normalizeCompanyForGrouping('Acme Corp Sp. z o.o.')).toBe('acme corp');
      expect(normalizeCompanyForGrouping('FinTech Solutions Spółka z o.o.')).toBe('fintech solutions');
      expect(normalizeCompanyForGrouping('Legacy Systems S.A.')).toBe('legacy systems');
      expect(normalizeCompanyForGrouping('Global Cloud Inc.')).toBe('global cloud');
    });
  });

  describe('analyzeFeedbackPatterns', () => {
    const mockLogs: EvaluationLogRecord[] = [
      {
        id: '1',
        title: 'Senior Node Developer',
        company: 'Outsource Giant Sp. z o.o.',
        tags: ['Node.js', 'AWS'],
        humanVerdict: 'Wrong – Should Reject',
        reasonCode: 'out',
      },
      {
        id: '2',
        title: 'Lead Frontend Engineer',
        company: 'Outsource Giant Sp. z o.o.',
        tags: ['React', 'TypeScript'],
        humanVerdict: 'Wrong – Should Reject',
        reasonCode: 'out',
      },
      {
        id: '3',
        title: 'Full Stack Engineer',
        company: 'Outsource Giant',
        tags: ['TypeScript', 'Node.js'],
        humanVerdict: 'Wrong – Should Reject',
        reasonCode: 'out',
      },
      {
        id: '4',
        title: 'PHP / Laravel Specialist',
        company: 'Random Agency',
        tags: ['PHP', 'Laravel'],
        humanVerdict: 'Wrong – Should Reject',
        reasonCode: 'leg',
      },
    ];

    it('synthesizes draft rule when company accumulates >= 3 rejections', () => {
      const drafts = analyzeFeedbackPatterns(mockLogs, 3);
      expect(drafts.length).toBeGreaterThanOrEqual(1);

      const companyDraft = drafts.find((d) => d.patternKey.startsWith('company:'));
      expect(companyDraft).toBeDefined();
      expect(companyDraft?.active).toBe(false); // strictly draft
      expect(companyDraft?.category).toBe('Hard Reject (Red Flag)');
      expect(companyDraft?.enforcement).toBe('Hard Gate (Code + Prompt)');
      expect(companyDraft?.ruleType).toBe('Force Reject (Score = 0)');
      expect(companyDraft?.valueKeywords).toContain('Outsource Giant');
      expect(companyDraft?.occurrences).toBe(3);
    });

    it('does not synthesize rules when occurrences are below threshold', () => {
      const drafts = analyzeFeedbackPatterns(mockLogs, 4);
      expect(drafts).toHaveLength(0);
    });
  });

  describe('formatRuleActivationProposal', () => {
    it('formats proposal HTML message with 1-click activation inline button', () => {
      const draft = {
        ruleName: 'Auto-Guardrail: Block Outsource Giant',
        category: 'Hard Reject (Red Flag)' as const,
        enforcement: 'Hard Gate (Code + Prompt)' as const,
        ruleType: 'Force Reject (Score = 0)' as const,
        valueKeywords: 'Outsource Giant',
        ruleDescription: 'Auto-generated rule',
        active: false as const,
        occurrences: 3,
        patternKey: 'company:outsource_giant',
        sampleVacancies: ['Senior Dev @ Outsource Giant', 'Lead Eng @ Outsource Giant'],
      };

      const proposal = formatRuleActivationProposal(draft);
      expect(proposal.textHtml).toContain('Обнаружен повторяющийся паттерн отказов');
      expect(proposal.textHtml).toContain('Outsource Giant');
      expect(proposal.textHtml).toContain('Количество отказов:</b> 3');
      expect(proposal.keyboard.inline_keyboard[0][0].text).toBe('✅ Активировать в Notion');
      expect(proposal.keyboard.inline_keyboard[0][0].callback_data).toContain('act:company_outsource_giant');
    });
  });
});
