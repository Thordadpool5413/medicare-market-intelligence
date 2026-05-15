import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const port = Number(process.env.PORT || 8787);
const CMS_DATASTORE_BASE = "https://data.cms.gov/provider-data/api/1/datastore/query";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const DATASETS = {
  hospitalGeneral: {
    id: "xubh-q36u",
    label: "Hospital General Information"
  },
  hospiceGeneral: {
    id: "yc9t-dgbk",
    label: "Hospice General Information"
  },
  hospiceProvider: {
    id: "252m-zfp9",
    label: "Hospice Provider Data"
  },
  readmissionsReduction: {
    id: "9n3s-kdb3",
    label: "Hospital Readmissions Reduction Program"
  },
  unplannedHospitalVisits: {
    id: "632h-zaca",
    label: "Unplanned Hospital Visits"
  }
};

const STATE_MAP = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC"
};

const riskyPatterns = [
  { name: "Social Security number", pattern: /\b\d{3}\s?\d{2}\s?\d{4}\b/i },
  { name: "medical record number", pattern: /\b(mrn|medical record|record number|patient id|claim id)\b/i },
  { name: "date of birth", pattern: /\b(dob|date of birth)\b/i },
  { name: "direct patient reference", pattern: /\b(patient name|named patient|specific patient)\b/i }
];

const memoryCache = new Map();
const CACHE_MS = 1000 * 60 * 45;

function readText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "" || value === "Not Available") return fallback;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function checkForPatientIdentifiers(value) {
  const text = value.trim();

  if (!text) {
    return {
      ok: false,
      message: "Please enter a market question before running the analysis."
    };
  }

  for (const item of riskyPatterns) {
    if (item.pattern.test(text)) {
      return {
        ok: false,
        message: `Possible ${item.name} detected. Remove patient identifiers before using this public Medicare intelligence app.`
      };
    }
  }

  return { ok: true };
}

function parseGeography(geography) {
  const raw = cleanString(geography);
  const lower = raw.toLowerCase();
  let state = null;

  for (const [stateName, abbr] of Object.entries(STATE_MAP)) {
    if (lower.includes(stateName)) {
      state = abbr;
      break;
    }
  }

  const stateCodeMatch = raw.match(/\b([A-Z]{2})\b/);
  if (!state && stateCodeMatch) {
    state = stateCodeMatch[1];
  }

  const countyMatch = raw.match(/([A-Za-z .'-]+)\s+County/i);
  const county = countyMatch ? countyMatch[1].trim().toUpperCase() : null;
  const zipMatch = raw.match(/\b\d{5}\b/);
  const zip = zipMatch ? zipMatch[0] : null;

  const cityCandidate = raw
    .replace(/\b\d{5}\b/g, "")
    .replace(/county/gi, "")
    .replace(new RegExp(Object.keys(STATE_MAP).join("|"), "gi"), "")
    .replace(/\b[A-Z]{2}\b/g, "")
    .replace(/,/g, "")
    .trim();

  return {
    raw,
    state,
    county,
    zip,
    city: cityCandidate && !county ? cityCandidate.toUpperCase() : null
  };
}

function rowValue(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== "") return row[name];
  }
  return "";
}

function filterRowsByGeography(rows, geography, rowType) {
  const parsed = parseGeography(geography);

  return rows.filter((row) => {
    const state = cleanString(rowValue(row, ["state", "state_code"])).toUpperCase();
    const county = cleanString(rowValue(row, ["countyparish", "county", "county_name"])).toUpperCase();
    const city = cleanString(rowValue(row, ["citytown", "city", "provider_city"])).toUpperCase();
    const zip = cleanString(rowValue(row, ["zip_code", "zip", "provider_zip_code"]));

    if (parsed.state && state && state !== parsed.state) return false;
    if (parsed.zip && zip && !zip.startsWith(parsed.zip)) return false;
    if (parsed.county && county && county !== parsed.county) return false;
    if (parsed.city && city && !city.includes(parsed.city)) return false;

    if (!parsed.state && !parsed.county && !parsed.city && !parsed.zip) {
      const searchable = `${state} ${county} ${city} ${zip} ${cleanString(row.facility_name)} ${cleanString(row.provider_name)}`.toLowerCase();
      return searchable.includes(parsed.raw.toLowerCase());
    }

    return true;
  });
}

async function fetchCmsDataset(datasetId) {
  const cacheKey = datasetId;
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_MS) {
    return cached.rows;
  }

  const pageSize = 5000;
  let offset = 0;
  const allRows = [];

  for (let page = 0; page < 6; page += 1) {
    const url = `${CMS_DATASTORE_BASE}/${datasetId}/0?limit=${pageSize}&offset=${offset}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });

    if (!response.ok) {
      throw new Error(`CMS dataset ${datasetId} returned HTTP ${response.status}`);
    }

    const json = await response.json();
    const rows = Array.isArray(json.results) ? json.results : [];
    allRows.push(...rows);

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  memoryCache.set(cacheKey, { rows: allRows, createdAt: Date.now() });
  return allRows;
}

function scoreHospital(row) {
  const rating = toNumber(row.hospital_overall_rating, 0);
  const readmWorse = toNumber(row.count_of_readm_measures_worse, 0);
  const mortWorse = toNumber(row.count_of_mort_measures_worse, 0);
  const safetyWorse = toNumber(row.count_of_safety_measures_worse, 0);
  const readmMeasures = toNumber(row.count_of_facility_readm_measures, 0);
  const mortalityMeasures = toNumber(row.count_of_facility_mort_measures, 0);
  const emergency = cleanString(row.emergency_services).toLowerCase() === "yes" ? 5 : 0;
  const ratingPressure = rating > 0 ? (5 - rating) * 9 : 20;

  const rawScore = ratingPressure + readmWorse * 18 + mortWorse * 12 + safetyWorse * 10 + Math.min(readmMeasures, 11) * 1.5 + Math.min(mortalityMeasures, 8) + emergency;
  const opportunityScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    facilityId: cleanString(row.facility_id),
    name: cleanString(row.facility_name),
    address: cleanString(row.address),
    city: cleanString(row.citytown),
    state: cleanString(row.state),
    zip: cleanString(row.zip_code),
    county: cleanString(row.countyparish),
    phone: cleanString(row.telephone_number),
    type: cleanString(row.hospital_type),
    ownership: cleanString(row.hospital_ownership),
    emergencyServices: cleanString(row.emergency_services),
    overallRating: rating || null,
    readmissionWorseCount: readmWorse,
    mortalityWorseCount: mortWorse,
    safetyWorseCount: safetyWorse,
    readmissionMeasures: readmMeasures,
    opportunityScore,
    priority: opportunityScore >= 65 ? "High" : opportunityScore >= 42 ? "Medium" : "Lower",
    rationale: [
      rating ? `Overall CMS rating ${rating}` : "CMS overall rating not available",
      `${readmWorse} readmission measure group worse than average`,
      `${mortWorse} mortality measure group worse than average`,
      `${safetyWorse} safety measure group worse than average`
    ].join(". ")
  };
}

function summarizeHospiceRows(rows) {
  const names = rows.map((row) => cleanString(rowValue(row, ["provider_name", "facility_name", "hospice_name", "name"]))).filter(Boolean);
  const uniqueNames = Array.from(new Set(names));
  const ownershipCounts = {};

  for (const row of rows) {
    const ownership = cleanString(rowValue(row, ["ownership_type", "provider_type", "type_of_ownership", "ownership"]));
    if (ownership) ownershipCounts[ownership] = (ownershipCounts[ownership] || 0) + 1;
  }

  return {
    providerCount: uniqueNames.length || rows.length,
    recordsReviewed: rows.length,
    topProviders: uniqueNames.slice(0, 12),
    ownershipCounts
  };
}

function summarizeHospitals(scoredHospitals) {
  const ratingValues = scoredHospitals.map((row) => row.overallRating).filter((value) => typeof value === "number" && value > 0);
  const averageRating = ratingValues.length ? Number((ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length).toFixed(2)) : null;
  const highPriority = scoredHospitals.filter((row) => row.priority === "High").length;
  const readmissionPressure = scoredHospitals.filter((row) => row.readmissionWorseCount > 0).length;

  return {
    hospitalCount: scoredHospitals.length,
    averageRating,
    highPriorityHospitalCount: highPriority,
    hospitalsWithReadmissionPressure: readmissionPressure,
    highestOpportunityHospitals: scoredHospitals.slice(0, 15)
  };
}

function buildFieldStrategy(analytics) {
  const top = analytics.hospitals.highestOpportunityHospitals.slice(0, 5);
  const topNames = top.map((row) => row.name).filter(Boolean);

  return {
    executiveView:
      analytics.hospitals.hospitalCount === 0
        ? "No hospital records matched the requested geography. Broaden the geography or use a state, county, city, or ZIP code."
        : `${analytics.hospitals.hospitalCount} hospitals matched the requested geography. ${analytics.hospitals.highPriorityHospitalCount} scored as high education opportunity based on CMS rating pressure, readmission pressure, mortality signal pressure, and safety signal pressure.`,
    priorityTargets: top.map((row) => ({
      name: row.name,
      priority: row.priority,
      opportunityScore: row.opportunityScore,
      recommendedAngle: "Lead with serious illness education, avoidable crisis reduction, goals of care clarity, family readiness, and transition support. Do not frame outreach as a promise to reduce readmissions or secure referrals."
    })),
    coachingNotes: [
      "Use CMS signals as a market education lens, not as a patient targeting tool.",
      "Focus conversations on earlier eligibility recognition, caregiver stress, symptom escalation, and transition planning.",
      "For hospitals with readmission pressure, position hospice education around clarity and support before crisis events, not around chasing discharge volume.",
      topNames.length ? `Start with these highest scoring facilities: ${topNames.join(", ")}.` : "No named priority facilities were available for this geography."
    ]
  };
}

function buildMedicareMarketPrompt(input, analytics) {
  return `You are a Medicare market intelligence analyst supporting hospice growth strategy. Use the provided CMS Provider Data analytics below. Do not invent provider names, hospital metrics, star ratings, spending amounts, utilization rates, quality measures, readmission figures, or county level facts. If a requested data point is unavailable, say so clearly.

Business context:
The user needs compliant, practical field intelligence for hospice education and referral strategy. The response must stay away from patient level information, patient targeting, claim specific targeting, and anything that could be interpreted as using PHI.

User request:
Question: ${input.question}
Geography: ${input.geography}
Audience: ${input.audience}
Preferred output style: ${input.outputStyle}

CMS analytics JSON:
${JSON.stringify(analytics, null, 2)}

Return a concise but useful interpretation in this structure:
Executive view
What the CMS data shows
Highest opportunity facilities
Hospice market context
Compliant field conversation angles
Data limitations
Recommended next steps`;
}

async function buildAnalytics(input) {
  const [hospitalRows, hospiceRows] = await Promise.all([
    fetchCmsDataset(DATASETS.hospitalGeneral.id),
    fetchCmsDataset(DATASETS.hospiceGeneral.id).catch(() => [])
  ]);

  const filteredHospitals = filterRowsByGeography(hospitalRows, input.geography, "hospital");
  const filteredHospice = filterRowsByGeography(hospiceRows, input.geography, "hospice");
  const scoredHospitals = filteredHospitals.map(scoreHospital).sort((a, b) => b.opportunityScore - a.opportunityScore);

  const analytics = {
    geography: parseGeography(input.geography),
    datasets: [
      { ...DATASETS.hospitalGeneral, recordsLoaded: hospitalRows.length, recordsMatched: filteredHospitals.length },
      { ...DATASETS.hospiceGeneral, recordsLoaded: hospiceRows.length, recordsMatched: filteredHospice.length }
    ],
    hospitals: summarizeHospitals(scoredHospitals),
    hospice: summarizeHospiceRows(filteredHospice),
    fieldStrategy: null,
    generatedAt: new Date().toISOString()
  };

  analytics.fieldStrategy = buildFieldStrategy(analytics);
  return analytics;
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "Medicare Market Intelligence API",
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    mcpServer: process.env.CMS_MEDICARE_MCP_URL || "https://mcp.olyport.com/cms-medicare/mcp",
    cmsDatasets: DATASETS,
    generatedAt: new Date().toISOString()
  });
});

app.get("/api/datasets", (_request, response) => {
  response.json({ datasets: DATASETS });
});

app.post("/api/analytics", async (request, response) => {
  const input = {
    question: readText(request.body?.question) || "Build Medicare market analytics.",
    geography: readText(request.body?.geography),
    audience: readText(request.body?.audience) || "Hospice sales leader",
    outputStyle: readText(request.body?.outputStyle) || "Analytics dashboard"
  };

  if (!input.geography) {
    response.status(400).json({ error: "Please enter a geography, such as Brevard County, Florida, Orlando, FL, or 32937." });
    return;
  }

  const compliance = checkForPatientIdentifiers(Object.values(input).join("\n"));
  if (!compliance.ok) {
    response.status(400).json({ error: compliance.message });
    return;
  }

  try {
    const analytics = await buildAnalytics(input);
    response.json({ analytics });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error while loading CMS analytics." });
  }
});

app.post("/api/analyze", async (request, response) => {
  const input = {
    question: readText(request.body?.question),
    geography: readText(request.body?.geography),
    audience: readText(request.body?.audience) || "Hospice sales leader",
    outputStyle: readText(request.body?.outputStyle) || "Leadership ready field intelligence"
  };

  if (!input.question) {
    response.status(400).json({ error: "Please enter a Medicare market question." });
    return;
  }

  if (!input.geography) {
    response.status(400).json({ error: "Please enter a geography, such as a county, city, state, hospital market, or territory." });
    return;
  }

  const compliance = checkForPatientIdentifiers(Object.values(input).join("\n"));
  if (!compliance.ok) {
    response.status(400).json({ error: compliance.message });
    return;
  }

  try {
    const analytics = await buildAnalytics(input);

    if (!process.env.OPENAI_API_KEY) {
      response.json({
        analysis: analytics.fieldStrategy.executiveView,
        analytics,
        meta: {
          mode: "cms-analytics-only",
          reason: "OPENAI_API_KEY was not available, so the server returned calculated CMS analytics without AI narrative.",
          generatedAt: new Date().toISOString()
        }
      });
      return;
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || "gpt-5.5";
    const mcpServer = process.env.CMS_MEDICARE_MCP_URL || "https://mcp.olyport.com/cms-medicare/mcp";

    const result = await client.responses.create({
      model,
      tools: [
        {
          type: "mcp",
          server_label: "cms_medicare",
          server_description: "Public CMS Medicare data including Medicare spending, chronic conditions, hospital quality, readmissions, and enrollment.",
          server_url: mcpServer,
          require_approval: "never"
        }
      ],
      input: buildMedicareMarketPrompt(input, analytics)
    });

    response.json({
      analysis: result.output_text || analytics.fieldStrategy.executiveView,
      analytics,
      meta: {
        mode: "cms-analytics-plus-ai",
        model,
        mcpServer,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error while calling the CMS analytics and OpenAI analysis flow."
    });
  }
});

app.listen(port, () => {
  console.log(`Medicare Market Intelligence API running on port ${port}`);
});
