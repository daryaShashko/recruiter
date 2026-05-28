/// <reference lib="dom" />
import { openPage, closeBrowser } from "./utils/browser";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";

const TARGET_URL = "https://justjoin.it/job-offer/scalo-frontend-developer-katowice-javascript-be64deb3";

async function main() {
  console.log(`[Scrape One] Fetching job page: ${TARGET_URL}`);
  const { page, context } = await openPage();

  try {
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000); // let it render

    // Extract details
    const title = await page.title();
    console.log(`[Scrape One] Page Title: ${title}`);

    // Let's get the text content of the body or main sections
    const pageText = await page.evaluate(() => {
      // Find main description container. In JustJoin it is usually inside article or specific class.
      // Let's grab all text from the body to be safe, or main containers.
      const selectors = ['article', '[class*="OfferDescription"]', '[class*="offer-details"]', 'main'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.textContent || "";
          if (text.trim().length > 200) {
            return text;
          }
        }
      }
      return document.body.innerText || "";
    });

    console.log(`[Scrape One] Extracted text length: ${pageText.length}`);
    console.log(`[Scrape One] First 300 chars of text:\n${pageText.substring(0, 300)}\n...`);

    // Let's build the synthetic offer like we do in scraper
    const jobOffer = {
      title: "Frontend Developer",
      company: "SCALO",
      location: "Katowice",
      salary: "19 200 - 22 400 PLN Net/month (b2b)",
      url: TARGET_URL,
      body: pageText
    };

    // Load candidate profile
    const profilePath = "/Users/Darya_Shashko/projects/recruiter/n8n/prompts/candidate_profile.md";
    const profile = fs.readFileSync(profilePath, "utf8");

    // Construct System Prompt (copied from ingest.json)
    const systemPrompt = `You are an expert IT recruiter assistant. Your task is to evaluate job postings and compute a multidimensional match score for a candidate based on their custom profile.

**Candidate Profile:**
<candidate_profile>
${profile}
</candidate_profile>

**CRITICAL AND ABSOLUTE REJECTION RULES (FORCE REJECT — SET OVERALL_SCORE TO 0):**
You MUST immediately reject the vacancy and output an \`overall_score\` of 0, \`tech_stack_match\` of 0, and add the violation to \`red_flags\` if the vacancy meets ANY of the following:
1. **Crypto / Web3 / Blockchain**: The company or job description is related to cryptocurrency, blockchain, Web3, NFT, DeFi, or smart contracts (e.g., Solana, Ethereum, Bitcoin, crypto exchange, crypto wallet, decentralized apps, etc.). This is a strict blocker!
2. **Gambling / Betting**: The company is in the gambling, casino, betting, or sports-betting industry.
3. **Agency / Outsourcing / Outstaffing**: The company is an outsourcing agency, vendor, or outstaffing company (e.g. EPAM, Luxoft, and similar models). The candidate ONLY wants a Product company.
4. **Legacy Maintenance**: The job involves maintaining or building new features directly inside legacy codebases (PHP, Java, C#, C++, Ruby) without a greenfield rewrite/migration scope. (The candidate is fine with legacy only if the entire job is migrating/rewriting it to Node.js/TypeScript).
5. **Pure Frontend or Pure Backend**: The job is pure React/UI frontend (pixel-pushing, pure layout/CSS without system state/APIs) OR pure senior backend (heavy architectural backend experience from day one). The candidate wants a Full-Stack role (from 50/50 to 70/30 in favor of frontend).
6. **Wrong Location**: The job requires hybrid or in-office presence in Warsaw, Kraków, Wrocław, Katowice, or any city other than Gdańsk/Tricity.
7. **Financial Mismatch**: The salary translates to less than 18,000 PLN/month NET on hands (equivalent to ~22,000 PLN B2B net before taxes, or ~28,000 PLN UoP Gross).

**Scoring Guidelines (overall_score: 0 to 100):**
1. **Hot Match (score >= 80)**:
   - Position matches candidate's stack (JavaScript/TypeScript/React/Next.js/Node.js primary) and seniority.
   - Meets or exceeds salary expectations (desired ~20k PLN net on hands; B2B 25k-30k net; UoP ~32k gross).
   - Matches location preferences (fully remote or hybrid/office Gdańsk/Tricity).
   - Strongly matches domain preferences and leadership ambitions.
2. **Review Match (score 50 to 79)**:
   - Candidate is a decent fit but has minor mismatches.
   - Salary is slightly below target but strictly above the absolute hard floor of 18,000 PLN net on hands.
   - Frontend or database differs slightly from preference but core TS/JS backend and React frontend scope matches.
3. **Discard/No Match (score < 50)**:
   - Position is explicitly Junior/Mid-level (< 3 years experience or low seniority).
   - Primary backend is Java, C#, .NET, PHP, Go, etc. (Node.js/TS is absent or secondary).
   - Position violates ANY of the CRITICAL AND ABSOLUTE REJECTION RULES listed above (sets score to 0 immediately).

   **CRITICAL RULE:** If a vacancy matches ANY of the Discard/No Match or Rejection criteria, the \`overall_score\` MUST be strictly less than 50 (and exactly 0 for critical rule violations) as a hard-stop block, and the violation MUST be noted in \`red_flags\`.

**Dimension Breakdown:**
1. **tech_stack_match (0 to 100)**:
   - 90-100: Backend is Node.js/TypeScript/PostgreSQL, frontend React/Next.js.
   - 70-89: Backend Node.js/TS, but database/frontend varies.
   - 40-69: Node.js/TS present but secondary (e.g., active migration from Java/Go, or BFF layer), or pure frontend React/Next.js role.
   - < 40: Main stack is non-JS or no JS backend/frontend mentioned.
2. **seniority_match (0 to 100)**:
   - 90-100: Title or description explicitly requests Senior, Lead, Architect, Principal, or Staff.
   - 60-89: Strong Mid/Regular role requesting 4+ years of experience, or where duties map to senior level.
   - < 60: Junior, entry-level, internship, or requires <2 years experience.

**Response Format:**
You MUST respond ONLY with valid JSON. No markdown, no explanation outside JSON.
{
  "overall_score": 85,
  "tech_stack_match": 90,
  "seniority_match": 80,
  "red_flags": ["Low salary", "Wrong location"],
  "reason": "One sentence explaining the decision breakdown",
  "url": "the job URL passed in the prompt"
}

**CRITICAL red_flags FORMATTING RULES:**
- "red_flags" MUST be a flat array of short, clean, one-phrase text strings (strictly strings, NOT objects).
- Each red flag string MUST be a simple tag of 2-5 words (e.g. "Low salary", "Wrong location", "EPAM company", "Legacy stack").
- Do NOT include bullet points, markdown symbols (like *, -, #, or backticks), HTML, or newlines in the red flags.
- Do NOT use commas inside a single red flag string (replace them with spaces or semicolons, e.g. "Salary 15000 PLN B2B" instead of "Salary: 15,000 PLN"). This is crucial so that n8n/Notion splits them correctly.`;

    const userContent = [
      `Job Title: ${jobOffer.title}`,
      `Company: ${jobOffer.company}`,
      `Location: ${jobOffer.location}`,
      `Salary: ${jobOffer.salary}`,
      `URL: ${jobOffer.url}`,
      '',
      'Job Description:',
      jobOffer.body
    ].join('\n');

    console.log(`[Scrape One] Calling Ollama with format: json...`);
    const response = await axios.post("http://127.0.0.1:11434/api/chat", {
      model: 'llama3.1:latest',
      stream: false,
      format: 'json',
      keep_alive: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    }, { timeout: 300000 });

    console.log(`[Scrape One] Ollama raw response:`);
    console.log(JSON.stringify(response.data, null, 2));

    const content = response.data?.message?.content || "";
    console.log(`\n[Scrape One] Content field:`);
    console.log(content);

    // Parsing test
    console.log(`\n[Scrape One] Simulating parsing...`);
    let parsed;
    try {
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start === -1 || end === -1 || end < start) {
        throw new Error("No JSON object found in response");
      }
      const cleaned = content.substring(start, end + 1).trim();
      parsed = JSON.parse(cleaned);
    } catch (e: any) {
      console.error(`Failed to parse: ${e.message}`);
      return;
    }

    // Predefined clean taxonomy tags mapper
    const mapToStandardTag = (rawTag: any) => {
      if (typeof rawTag === 'object' && rawTag !== null) {
        rawTag = rawTag.reason || rawTag.category || JSON.stringify(rawTag);
      }
      const text = String(rawTag).toLowerCase();

      // Industry
      if (text.includes('crypto') || text.includes('web3') || text.includes('blockchain') || text.includes('solana') || text.includes('nft')) {
        return 'Industry: Crypto/Web3';
      }
      if (text.includes('gambling') || text.includes('betting') || text.includes('casino')) {
        return 'Industry: Gambling/Betting';
      }
      if (text.includes('agency') || text.includes('outsourcing') || text.includes('outstaffing') || text.includes('epam') || text.includes('luxoft')) {
        return 'Industry: Agency/Outsourcing';
      }

      // Location
      if (text.includes('warsaw') || text.includes('warszawa')) return 'Location: Warsaw';
      if (text.includes('krakow') || text.includes('kraków')) return 'Location: Kraków';
      if (text.includes('wroclaw') || text.includes('wrocław')) return 'Location: Wrocław';
      if (text.includes('location preference') || text.includes('not fully remote') || text.includes('workplace type') || text.includes('katowice')) {
        return 'Location: Mismatch';
      }
      if (text.includes('on-site') || text.includes('onsite')) return 'Location: On-site Only';

      // Salary
      if (text.includes('below preferred') || text.includes('preferred range')) return 'Salary: Below Preferred';
      if (text.includes('hard floor') || text.includes('below hard floor') || text.includes('absolute hard floor')) return 'Salary: Below Hard Floor';
      if (text.includes('salary') || text.includes('budget') || text.includes('pln') || text.includes('usd')) {
        return 'Salary: Low/Unspecified';
      }

      // Stack
      if (text.includes('legacy') || text.includes('maintenance') || text.includes('php') || text.includes('java') || text.includes('c++') || text.includes('c#')) {
        return 'Stack: Legacy/Non-JS';
      }
      if (text.includes('pure frontend') || text.includes('react-only') || text.includes('only frontend')) {
        return 'Stack: Pure Frontend';
      }
      if (text.includes('pure backend') || text.includes('only backend')) {
        return 'Stack: Pure Backend';
      }
      if (text.includes('flutter') || text.includes('mobile') || text.includes('react native')) {
        return 'Stack: Mobile/Flutter';
      }
      if (text.includes('stack mismatch') || text.includes('backend stack') || text.includes('non-js')) {
        return 'Stack: Mismatch';
      }

      // Seniority
      if (text.includes('seniority') || text.includes('junior') || text.includes('mid') || text.includes('regular') || text.includes('experience level')) {
        return 'Seniority: Junior/Mid';
      }

      // Clean raw string
      let clean = String(rawTag)
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/__/g, '')
        .replace(/_/g, '')
        .replace(/`/g, '')
        .replace(/,/g, ';')
        .replace(/^[\s\-\+\•\=\>]+/g, '')
        .trim();

      // Truncate to avoid giant tags
      const words = clean.split(/\s+/);
      if (words.length > 5) {
        clean = words.slice(0, 4).join(' ') + '...';
      }

      return clean || 'Other: Violation';
    };

    const rawRedFlags = Array.isArray(parsed.red_flags) ? parsed.red_flags : [];
    const redFlags = rawRedFlags
      .map((f: any) => mapToStandardTag(f))
      .filter((f: string) => f.length > 0);

    // Heuristics Check to programmatically enforce absolute rejection rules
    const jobTitleLower = (jobOffer.title || '').toLowerCase();
    const jobCompanyLower = (jobOffer.company || '').toLowerCase();
    const jobLocationLower = (jobOffer.location || '').toLowerCase();
    const jobBodyLower = (jobOffer.body || '').toLowerCase();

    const isRemote = jobLocationLower.includes('remote') || 
                     jobLocationLower.includes('zdalna') || 
                     jobLocationLower.includes('zdalne') || 
                     jobLocationLower.includes('zdalny') || 
                     jobBodyLower.includes('fully remote') || 
                     jobBodyLower.includes('100% remote') || 
                     jobBodyLower.includes('w 100% zdalnie');
                     
    const isTricity = jobLocationLower.includes('gdansk') || 
                      jobLocationLower.includes('gdańsk') || 
                      jobLocationLower.includes('gdynia') || 
                      jobLocationLower.includes('sopot') || 
                      jobLocationLower.includes('trojmiasto') || 
                      jobLocationLower.includes('trójmiasto');

    // 1. Wrong Location Programmatic Check
    const wrongCities = ['warsaw', 'warszawa', 'krakow', 'kraków', 'wroclaw', 'wrocław', 'katowice', 'poznan', 'poznań', 'lodz', 'łódź', 'szczecin', 'lublin', 'bydgoszcz'];
    const isWrongLocation = wrongCities.some(city => jobLocationLower.includes(city)) && !isRemote;
    const bodyRequiresWrongOffice = (jobBodyLower.includes('hybrid') || jobBodyLower.includes('hybrydowa') || jobBodyLower.includes('office') || jobBodyLower.includes('biur')) && 
      wrongCities.some(city => jobBodyLower.includes(city)) && 
      !jobBodyLower.includes('100% remote') && 
      !jobBodyLower.includes('fully remote');

    if (isWrongLocation || bodyRequiresWrongOffice || (!isRemote && !isTricity && jobLocationLower.length > 0)) {
      if (!redFlags.includes('Location: Mismatch')) {
        redFlags.push('Location: Mismatch');
      }
      parsed.overall_score = 0;
      parsed.tech_stack_match = 0;
    }

    // 2. Outsourcing / Agency Programmatic Check
    const outsourcingKeywords = ['epam', 'luxoft', 'capgemini', 'accenture', 'sii', 'infosys', 'cognizant', 'wipro', 'tcs', 'tata consultancy', 'outstaffing', 'outsourcing agency', 'outsourcing company'];
    const isAgency = outsourcingKeywords.some(keyword => jobCompanyLower.includes(keyword) || jobBodyLower.includes('outsourcing agency') || jobBodyLower.includes('outstaffing') || jobBodyLower.includes('outsourcing company'));
    if (isAgency) {
      if (!redFlags.includes('Industry: Agency/Outsourcing')) {
        redFlags.push('Industry: Agency/Outsourcing');
      }
      parsed.overall_score = 0;
    }

    // 3. Crypto / Web3 Programmatic Check
    const cryptoKeywords = ['crypto', 'web3', 'blockchain', 'solana', 'bitcoin', 'ethereum', 'nft', 'defi', 'smart contract'];
    const isCrypto = cryptoKeywords.some(keyword => jobTitleLower.includes(keyword) || jobBodyLower.includes(keyword));
    if (isCrypto) {
      if (!redFlags.includes('Industry: Crypto/Web3')) {
        redFlags.push('Industry: Crypto/Web3');
      }
      parsed.overall_score = 0;
      parsed.tech_stack_match = 0;
    }

    // 4. Gambling / Betting Programmatic Check
    const gamblingKeywords = ['gambling', 'betting', 'casino', 'sportsbook', 'sports-betting'];
    const isGambling = gamblingKeywords.some(keyword => jobTitleLower.includes(keyword) || jobBodyLower.includes(keyword));
    if (isGambling) {
      if (!redFlags.includes('Industry: Gambling/Betting')) {
        redFlags.push('Industry: Gambling/Betting');
      }
      parsed.overall_score = 0;
    }

    // 5. Post-process parsed red flags to enforce overall_score = 0 on critical violations
    const CRITICAL_FLAGS = [
      'Industry: Crypto/Web3',
      'Industry: Gambling/Betting',
      'Industry: Agency/Outsourcing',
      'Location: Mismatch',
      'Location: Warsaw',
      'Location: Kraków',
      'Location: Wrocław',
      'Salary: Below Hard Floor',
      'Stack: Legacy/Non-JS',
      'Stack: Pure Frontend',
      'Stack: Pure Backend'
    ];

    const hasCriticalFlag = redFlags.some((flag: string) => CRITICAL_FLAGS.includes(flag));
    if (hasCriticalFlag) {
      parsed.overall_score = 0;
    }

    const overallScore = Math.round(parsed.overall_score ?? 0);
    const techStackMatch = Math.round(parsed.tech_stack_match ?? 0);
    const seniorityMatch = Math.round(parsed.seniority_match ?? 0);
    const reasonBreakdown = parsed.reason || 'No reason provided';

    const finalParsed = {
      overall_score: overallScore,
      tech_stack_match: techStackMatch,
      seniority_match: seniorityMatch,
      red_flags: redFlags,
      reason: reasonBreakdown,
      url: parsed.url
    };

    console.log(`[Scrape One] Final parsed JSON:`);
    console.log(JSON.stringify(finalParsed, null, 2));

  } catch (err: any) {
    console.error(`[Scrape One] Error:`, err.message);
    if (err.response) {
      console.error(err.response.data);
    }
  } finally {
    await closeBrowser();
  }
}

main();
