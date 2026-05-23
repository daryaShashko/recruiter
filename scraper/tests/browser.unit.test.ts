/**
 * Unit tests for:
 *  - pickRandom()  (src/config.ts)
 *  - createContext() UA/viewport rotation  (src/utils/browser.ts)
 *
 * Playwright is fully mocked — no real browser is launched.
 */

// ── Mock playwright BEFORE any import of browser.ts ──────────────────────────
// jest.mock is hoisted, so this runs before module resolution.
jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

import { chromium } from 'playwright';
import { createContext } from '../src/utils/browser';
import { pickRandom, USER_AGENTS, VIEWPORTS } from '../src/config';

// ── pickRandom ────────────────────────────────────────────────────────────────

describe('pickRandom', () => {
  it('returns an element from the array (not undefined)', () => {
    const arr = ['a', 'b', 'c'];
    const result = pickRandom(arr);
    expect(result).toBeDefined();
    expect(arr).toContain(result);
  });

  it('always returns the only element of a single-item array', () => {
    expect(pickRandom(['only'])).toBe('only');
  });

  it('returns a string from USER_AGENTS', () => {
    const ua = pickRandom(USER_AGENTS);
    expect(typeof ua).toBe('string');
    expect(ua.length).toBeGreaterThan(0);
    // Value must come from the pool, not be fabricated
    expect(USER_AGENTS as readonly string[]).toContain(ua);
  });

  it('returns a viewport object from VIEWPORTS', () => {
    const vp = pickRandom(VIEWPORTS);
    expect(typeof vp.width).toBe('number');
    expect(typeof vp.height).toBe('number');
    expect(vp.width).toBeGreaterThan(0);
    expect(vp.height).toBeGreaterThan(0);
  });

  it('returns different values across multiple calls (distribution check)', () => {
    // With 5 items and 30 calls the probability of only 1 unique result is (1/5)^29 ≈ 0
    const results = new Set(Array.from({ length: 30 }, () => pickRandom(USER_AGENTS)));
    expect(results.size).toBeGreaterThan(1);
  });
});

// ── createContext UA rotation ─────────────────────────────────────────────────

describe('createContext', () => {
  /**
   * A single shared newContext mock.
   * Because browser.ts caches the Browser singleton, chromium.launch() is
   * called only once. All subsequent createContext() calls invoke
   * newContext on the *same* mock browser, so we can track every call here.
   */
  const addInitScriptMock = jest.fn().mockResolvedValue(undefined);
  const newContextMock = jest.fn().mockResolvedValue({
    addInitScript: addInitScriptMock,
  });

  beforeAll(() => {
    // Wire up the mock browser once — the singleton picks this up on first use.
    (chromium.launch as jest.Mock).mockResolvedValue({
      newContext: newContextMock,
    });
  });

  beforeEach(() => {
    // Reset call records between tests while keeping the mock implementation.
    newContextMock.mockClear();
    addInitScriptMock.mockClear();
  });

  it('passes a userAgent from USER_AGENTS to newContext', async () => {
    await createContext();

    expect(newContextMock).toHaveBeenCalledTimes(1);
    const options = newContextMock.mock.calls[0][0] as { userAgent: string };
    expect(USER_AGENTS as readonly string[]).toContain(options.userAgent);
  });

  it('passes a viewport from VIEWPORTS to newContext', async () => {
    await createContext();

    const options = newContextMock.mock.calls[0][0] as {
      viewport: { width: number; height: number };
    };
    const match = VIEWPORTS.find(
      (v) => v.width === options.viewport.width && v.height === options.viewport.height
    );
    expect(match).toBeDefined();
  });

  it('Sec-Ch-Ua header contains the Chrome version from the selected UA', async () => {
    await createContext();

    const options = newContextMock.mock.calls[0][0] as {
      userAgent: string;
      extraHTTPHeaders: Record<string, string>;
    };
    const versionMatch = options.userAgent.match(/Chrome\/(\d+)/);
    expect(versionMatch).not.toBeNull();
    const version = versionMatch![1];

    expect(options.extraHTTPHeaders['Sec-Ch-Ua']).toContain(`"Chromium";v="${version}"`);
    expect(options.extraHTTPHeaders['Sec-Ch-Ua']).toContain(`"Google Chrome";v="${version}"`);
  });

  it('Sec-Ch-Ua-Platform is consistent with the selected UA OS', async () => {
    await createContext();

    const options = newContextMock.mock.calls[0][0] as {
      userAgent: string;
      extraHTTPHeaders: Record<string, string>;
    };
    const platform = options.extraHTTPHeaders['Sec-Ch-Ua-Platform'];

    if (options.userAgent.includes('Windows')) {
      expect(platform).toBe('"Windows"');
    } else if (options.userAgent.includes('Macintosh')) {
      expect(platform).toBe('"macOS"');
    } else {
      expect(platform).toBe('"Linux"');
    }
  });

  it('can return different User-Agents across 3 calls (rotation works)', async () => {
    // Control Math.random so the test is fully deterministic:
    //   Call 1: random → 0.00 (UA idx 0), 0.00 (VP idx 0)
    //   Call 2: random → 0.50 (UA idx 2), 0.00 (VP idx 0)
    //   Call 3: random → 0.90 (UA idx 4), 0.00 (VP idx 0)
    // → 3 distinct UAs from the 5-item pool.
    const randoms = [0.00, 0.00, 0.50, 0.00, 0.90, 0.00];
    let idx = 0;
    const randomSpy = jest
      .spyOn(Math, 'random')
      .mockImplementation(() => randoms[idx++ % randoms.length]);

    try {
      await createContext();
      await createContext();
      await createContext();
    } finally {
      randomSpy.mockRestore();
    }

    expect(newContextMock).toHaveBeenCalledTimes(3);

    const userAgents = newContextMock.mock.calls.map(
      (call) => (call[0] as { userAgent: string }).userAgent
    );

    // All UAs must belong to the pool
    userAgents.forEach((ua) =>
      expect(USER_AGENTS as readonly string[]).toContain(ua)
    );

    // At least 2 distinct UAs must appear
    const unique = new Set(userAgents);
    expect(unique.size).toBeGreaterThan(1);
  });
});
