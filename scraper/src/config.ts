import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  webhookUrl: process.env.WEBHOOK_URL || '',

  scraper: {
    // Target locations (used for filtering)
    locations: ['gdansk', 'gdańsk', 'remote', 'zdalnie'],

    // Target tech stack (used for initial pre-filter before LLM)
    targetStack: ['javascript', 'typescript', 'node', 'react', 'postgresql', 'postgres'],

    // Reject if ONLY these stacks appear (before LLM evaluation)
    rejectStack: ['java', 'c#', '.net', 'php', 'ruby', 'go', 'rust', 'kotlin', 'swift'],

    // Target seniority levels
    targetLevels: ['senior', 'lead', 'principal', 'architect', 'staff'],

    // Reject junior/mid positions
    rejectLevels: ['junior', 'mid', 'regular', 'intern', 'trainee'],
  },

  playwright: {
    headless: true,
    // Viewport mimics a common desktop resolution
    viewport: { width: 1440, height: 900 },
    // Realistic user agent
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    // Timeout for navigation
    navigationTimeout: 30_000,
    // Timeout for network requests
    requestTimeout: 15_000,
  },

  sender: {
    // Max retries for webhook POST
    maxRetries: 3,
    // Initial delay between retries (ms), doubles each attempt
    retryDelay: 1_000,
  },
} as const;

export function validateConfig(): void {
  if (!config.webhookUrl) {
    throw new Error('WEBHOOK_URL environment variable is required');
  }
}
