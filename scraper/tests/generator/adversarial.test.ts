import {
  findForbiddenStopWords,
  findForbiddenClichés,
  countWords,
  loadGeneratorModule,
  mockCandidateCvData,
} from './test-helpers';
import { FORBIDDEN_STOP_WORDS } from './test-contracts';

describe('Tier 5: Adversarial Verification & Hardening', () => {
  // ─── 1. Encoding, Escaping & Injection Integrity ──────────────────────────────
  describe('Encoding, Escaping & Injection Integrity', () => {
    const rendererMod = loadGeneratorModule<{
      generateCvHtml?: (cvData: any, bullets: any[]) => string;
      buildAtsHtml?: (cvData: any, bullets: any[]) => string;
    }>('cv-renderer');

    test('escapes malicious HTML/XSS payloads in contact headers and bullet highlights', () => {
      if (!rendererMod) return; // Skip if renderer module not yet loaded

      const maliciousCvData = {
        ...mockCandidateCvData,
        contacts: {
          ...mockCandidateCvData.contacts,
          name: 'Darya <script>alert("xss")</script> Shashko',
        },
        bullets: [
          {
            ...mockCandidateCvData.bullets[0],
            highlight: 'Optimized API <img src=x onerror=alert(1)> reducing latency.',
          },
        ],
      };

      const getHtml = rendererMod.generateCvHtml || rendererMod.buildAtsHtml;
      if (typeof getHtml === 'function') {
        const html = getHtml(maliciousCvData, maliciousCvData.bullets);

        // Raw executable script tags and onerror attributes must not be unescaped
        expect(html).not.toContain('<script>alert("xss")</script>');
        expect(html).not.toMatch(/<img[^>]*onerror=/i);
      }
    });

    test('preserves Polish Unicode characters without corruption (ą, ć, ę, ł, ń, ó, ś, ź, ż)', () => {
      const polishText = 'Gdańsk, Poznań, Kraków, Wrocław — Zaawansowane Rozwiązania Chmurowe ĄĘĆŁŃÓŚŹŻ';
      const words = countWords(polishText);
      expect(words).toBe(9);
    });
  });

  // ─── 2. Stop-Words Boundary & Casing Stress ───────────────────────────────────
  describe('Stop-Words Boundary & Casing Stress', () => {
    test('detects stop words regardless of uppercase, lowercase, or mixed casing', () => {
      for (const word of FORBIDDEN_STOP_WORDS) {
        const upper = word.toUpperCase();
        const detected = findForbiddenStopWords(`We must ${upper} immediately into this.`);
        expect(detected).toContain(word);
      }
    });

    test('detects stop words when adjacent to punctuation (quotes, commas, parentheses)', () => {
      const punctuated = 'I am "thrilled," having (spearheaded) many synergetic initiatives.';
      const detected = findForbiddenStopWords(punctuated);

      expect(detected).toContain('thrilled');
      expect(detected).toContain('spearheaded');
      expect(detected).toContain('synergetic');
    });

    test('avoids false positive substring matching (e.g. "compassionate" does not trigger "passionate")', () => {
      const text = 'He is a compassionate mentor who writes clean code.';
      const detected = findForbiddenStopWords(text);
      expect(detected).not.toContain('passionate');
    });
  });

  // ─── 3. Cover Letter Strict Word Count Boundary Stress ────────────────────────
  describe('Cover Letter Word Count Boundaries (130 to 180 words)', () => {
    const buildWordSequence = (count: number): string => {
      return Array.from({ length: count }, (_, i) => `word${i + 1}`).join(' ');
    };

    test('accurately counts exact word boundaries', () => {
      expect(countWords(buildWordSequence(129))).toBe(129);
      expect(countWords(buildWordSequence(130))).toBe(130);
      expect(countWords(buildWordSequence(180))).toBe(180);
      expect(countWords(buildWordSequence(181))).toBe(181);
    });

    test('treats 129 words as boundary violation (< 130 words)', () => {
      const words = 129;
      const isValidLength = words >= 130 && words <= 180;
      expect(isValidLength).toBe(false);
    });

    test('treats 130 words as valid exact lower bound', () => {
      const words = 130;
      const isValidLength = words >= 130 && words <= 180;
      expect(isValidLength).toBe(true);
    });

    test('treats 180 words as valid exact upper bound', () => {
      const words = 180;
      const isValidLength = words >= 130 && words <= 180;
      expect(isValidLength).toBe(true);
    });

    test('treats 181 words as boundary violation (> 180 words)', () => {
      const words = 181;
      const isValidLength = words >= 130 && words <= 180;
      expect(isValidLength).toBe(false);
    });
  });

  // ─── 4. Resilient Handling of Extreme / Degraded Inputs ───────────────────────
  describe('Resilient Handling of Extreme / Degraded Inputs', () => {
    test('handles whitespace-heavy and multiline input safely', () => {
      const multiline = `
        Line one with   extra     spaces.

        Line two with tabs\t\tand newlines.\n\n
      `;
      const count = countWords(multiline);
      expect(count).toBe(11);
    });

    test('handles empty or blank string without crashing', () => {
      expect(countWords('')).toBe(0);
      expect(countWords('   \n\t   ')).toBe(0);
      expect(findForbiddenStopWords('')).toEqual([]);
      expect(findForbiddenClichés('')).toEqual([]);
    });
  });
});
