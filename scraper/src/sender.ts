import axios, { AxiosError } from 'axios';
import { JobOffer, WebhookPayload } from './types';
import { config } from './config';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send job offers to the n8n Webhook with exponential backoff retry.
 */
export async function sendToWebhook(jobs: JobOffer[], source: string): Promise<void> {
  if (!config.webhookUrl) {
    throw new Error('WEBHOOK_URL is not configured');
  }

  const payload: WebhookPayload = {
    jobs,
    meta: {
      source,
      count: jobs.length,
      sentAt: new Date().toISOString(),
    },
  };

  let attempt = 0;
  let delay = config.sender.retryDelay;

  while (attempt < config.sender.maxRetries) {
    attempt++;
    try {
      console.log(
        `[Sender] Attempt ${attempt}/${config.sender.maxRetries}: sending ${jobs.length} jobs to webhook...`
      );

      const response = await axios.post(config.webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AI-Recruiter-Scraper/1.0',
        },
        timeout: 15_000,
      });

      console.log(`[Sender] Webhook responded: ${response.status} ${response.statusText}`);
      return; // Success
    } catch (error) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const message = axiosError.message;

      if (attempt >= config.sender.maxRetries) {
        throw new Error(
          `[Sender] All ${config.sender.maxRetries} attempts failed. Last error: ${message}`
        );
      }

      console.warn(`[Sender] Attempt ${attempt} failed (${status ?? 'network error'}: ${message}). Retrying in ${delay}ms...`);
      await sleep(delay);
      delay *= 2; // Exponential backoff
    }
  }
}
