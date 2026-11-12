import axios from 'axios';
import { filterValidLinks, isOfferLinkValid } from '../src/utils/link-check';
import { JobOffer } from '../src/types';

jest.mock('axios');
const mockedGet = axios.get as jest.Mock;

function offer(overrides: Partial<JobOffer> = {}): JobOffer {
  return {
    id: 'x',
    title: 'Senior AI & Agents Engineer',
    company: 'Acme',
    url: 'https://nofluffjobs.com/job/senior-ai-agents-engineer-acme',
    body: '',
    source: 'nofluffjobs',
    location: 'Remote',
    tags: [],
    scrapedAt: new Date().toISOString(),
    ...overrides,
  } as JobOffer;
}

const page = (title: string) => ({ status: 200, data: `<html><title>${title}</title></html>` });

describe('isOfferLinkValid', () => {
  beforeEach(() => mockedGet.mockReset());

  it('accepts a page whose title contains the offer title', async () => {
    mockedGet.mockResolvedValue(
      page('Senior AI &amp; Agents Engineer Job | AI | Acme | Kraków | No Fluff Jobs.'),
    );
    expect(await isOfferLinkValid(offer())).toBe(true);
  });

  it('rejects the NoFluffJobs generic listing fallback', async () => {
    mockedGet.mockResolvedValue(
      page('Fullstack Jobs | Remote | Fresh offers with salary ranges | No Fluff Jobs.'),
    );
    expect(await isOfferLinkValid(offer())).toBe(false);
  });

  it('rejects the JustJoin error page', async () => {
    mockedGet.mockResolvedValue(page('IT Job Board and Job Offers | Just Join IT'));
    expect(
      await isOfferLinkValid(offer({ source: 'justjoin', url: 'https://justjoin.it/job-offer/x' })),
    ).toBe(false);
  });

  it('rejects non-200 and network errors', async () => {
    mockedGet.mockResolvedValue({ status: 404, data: '' });
    expect(await isOfferLinkValid(offer())).toBe(false);
    mockedGet.mockRejectedValue(new Error('timeout'));
    expect(await isOfferLinkValid(offer())).toBe(false);
  });
});

describe('status-only sources', () => {
  beforeEach(() => mockedGet.mockReset());

  it('drops only on 404/410, keeps blocks and live pages', async () => {
    const rec = offer({ source: 'recruitee', url: 'https://x.recruitee.com/o/a' });
    mockedGet.mockResolvedValue({ status: 404, data: '' });
    expect(await isOfferLinkValid(rec)).toBe(false);
    mockedGet.mockResolvedValue({ status: 403, data: '' });
    expect(await isOfferLinkValid(rec)).toBe(true);
    mockedGet.mockResolvedValue(page('Netherlands'));
    expect(await isOfferLinkValid(rec)).toBe(true);
  });
});

describe('filterValidLinks', () => {
  beforeEach(() => mockedGet.mockReset());

  it('drops bad checked-source offers and passes other sources through', async () => {
    mockedGet.mockResolvedValue(page('Generic listing'));
    const other = offer({ id: 'o', source: 'manual' });
    const result = await filterValidLinks([offer(), other]);
    expect(result).toEqual([other]);
  });
});
