import axios, { AxiosError } from "axios";
import { JobOffer, WebhookPayload } from "./types";
import { config } from "./config";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNonRetriableStatus(status: number | undefined): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404;
}

function buildWebhook404Hint(url: string): string {
  return (
    `[Sender] Webhook returned 404 for URL: ${url}. ` +
    "Check that the n8n workflow is active and WEBHOOK_URL path is correct " +
    "(usually /webhook/jobs/ingest for active workflow or /webhook-test/jobs/ingest for test mode)."
  );
}

function isInvalidUrlError(err: AxiosError): boolean {
  return err.code === "ERR_INVALID_URL" || err.message === "Invalid URL";
}

/**
 * Send job offers to the n8n Webhook with exponential backoff retry.
 */
export async function sendToWebhook(
  jobs: JobOffer[],
  source: string,
): Promise<void> {
  if (!config.webhookUrl) {
    throw new Error("WEBHOOK_URL is not configured");
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
        `[Sender] Attempt ${attempt}/${config.sender.maxRetries}: sending ${jobs.length} jobs to webhook...`,
      );

      const response = await axios.post(config.webhookUrl, payload, {
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "AI-Recruiter-Scraper/1.0",
          // Bypass localtunnel interstitial "Click to Continue" page
          "Bypass-Tunnel-Reminder": "true",
        },
        timeout: 15_000,
      });

      console.log(
        `[Sender] Webhook responded: ${response.status} ${response.statusText}`,
      );
      return; // Success
    } catch (error) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const message = axiosError.message;

      if (isInvalidUrlError(axiosError)) {
        throw new Error(
          `[Sender] WEBHOOK_URL is invalid: ${config.webhookUrl}`,
        );
      }

      if (status === 404) {
        throw new Error(buildWebhook404Hint(config.webhookUrl));
      }

      if (isNonRetriableStatus(status)) {
        throw new Error(
          `[Sender] Non-retriable webhook error (${status}): ${message}`,
        );
      }

      if (attempt >= config.sender.maxRetries) {
        throw new Error(
          `[Sender] All ${config.sender.maxRetries} attempts failed. Last error: ${message}`,
        );
      }

      console.warn(
        `[Sender] Attempt ${attempt} failed (${status ?? "network error"}: ${message}). Retrying in ${delay}ms...`,
      );
      await sleep(delay);
      delay *= 2; // Exponential backoff
    }
  }
}
