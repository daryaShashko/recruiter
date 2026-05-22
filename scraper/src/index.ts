import { scrapeJustJoin } from './scrapers/justjoin';
import { scrapeNoFluffJobs } from './scrapers/nofluffjobs';
import { sendToWebhook } from './sender';
import { validateConfig } from './config';
import { closeBrowser } from './utils/browser';
import { JobOffer } from './types';

function deduplicateOffers(offers: JobOffer[]): JobOffer[] {
  const seen = new Set<string>();
  return offers.filter((offer) => {
    if (seen.has(offer.id)) {
      return false;
    }
    seen.add(offer.id);
    return true;
  });
}

async function main(): Promise<void> {
  console.log('=== AI Recruiter Scraper ===');
  console.log(`Started at: ${new Date().toISOString()}`);

  try {
    validateConfig();
  } catch (err) {
    console.error('Configuration error:', err);
    process.exit(1);
  }

  const results = await Promise.allSettled([scrapeJustJoin(), scrapeNoFluffJobs()]);

  const allOffers: JobOffer[] = [];

  results.forEach((result, index) => {
    const scraperName = index === 0 ? 'JustJoin' : 'NoFluffJobs';
    if (result.status === 'fulfilled') {
      console.log(`[${scraperName}] Collected ${result.value.length} offers`);
      allOffers.push(...result.value);
    } else {
      console.error(`[${scraperName}] Scraper failed:`, result.reason);
    }
  });

  const deduplicated = deduplicateOffers(allOffers);
  console.log(
    `\nTotal: ${allOffers.length} collected, ${allOffers.length - deduplicated.length} duplicates removed, ${deduplicated.length} unique offers`
  );

  if (deduplicated.length === 0) {
    console.warn('No offers to send. Exiting.');
    return;
  }

  try {
    await sendToWebhook(deduplicated, 'scraper-combined');
    console.log(`\n✅ Successfully sent ${deduplicated.length} offers to webhook`);
  } catch (err) {
    console.error('Failed to send to webhook:', err);
    process.exit(1);
  } finally {
    await closeBrowser();
  }

  console.log(`\nFinished at: ${new Date().toISOString()}`);
}

main();
