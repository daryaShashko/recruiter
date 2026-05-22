import axios from 'axios';
import { sendToWebhook } from '../src/sender';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// The variable MUST be prefixed with "mock" so babel-jest hoists it correctly
// alongside the jest.mock() factory below.
let mockWebhookUrl = 'https://test.example.com/webhook';

jest.mock('../src/config', () => ({
  config: {
    // Getter reads mockWebhookUrl at call-time, allowing per-test control
    get webhookUrl() { return mockWebhookUrl; },
    sender: { maxRetries: 3, retryDelay: 0 },
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNetworkError(): Error {
  const err = new Error('Network Error') as any;
  err.isAxiosError = true;
  err.response = undefined;
  return err;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sendToWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebhookUrl = 'https://test.example.com/webhook';
  });

  it('resolves without error on a successful 200 response', async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 200, statusText: 'OK' });

    await expect(sendToWebhook([], 'test-source')).resolves.toBeUndefined();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('retries once after a network error and resolves on the second attempt', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(makeNetworkError())
      .mockResolvedValueOnce({ status: 200, statusText: 'OK' });

    await expect(sendToWebhook([], 'test-source')).resolves.toBeUndefined();
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('rejects with an error message after all 3 attempts fail', async () => {
    const networkErr = makeNetworkError();
    mockedAxios.post
      .mockRejectedValueOnce(networkErr)
      .mockRejectedValueOnce(networkErr)
      .mockRejectedValueOnce(networkErr);

    await expect(sendToWebhook([], 'test-source')).rejects.toThrow('All 3 attempts failed');
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
  });

  it('throws immediately when WEBHOOK_URL is not configured', async () => {
    mockWebhookUrl = '';

    await expect(sendToWebhook([], 'test-source')).rejects.toThrow(
      'WEBHOOK_URL is not configured',
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
