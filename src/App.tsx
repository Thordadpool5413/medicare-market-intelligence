import { FormEvent, useMemo, useState } from "react";

type FormState = {
  question: string;
  geography: string;
  audience: string;
  outputStyle: string;
};

type CmsRow = Record<string, string | number | null | undefined>;

type Hospital = {
  facilityId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  phone: string;
  type: string;
  ownership: string;
  overallRating: number | null;
  readmissionWorseCount: number;
  mortalityWorseCount: number;
  safetyWorseCount: number;
  readmissionMeasures: number;
  opportunityScore: number;
  priority: string;
  rationale: string;
};

type Analytics = {
  geography: {
    raw: string;
    state?: string | null;
    county?: string | null;
    city?: string | null;
    zip?: string | null;
  };
  datasets: Array<{
    id: string;
    label: string;
    recordsLoaded: number;
    recordsMatched: number;
    source: string;
  }>;
  hospitals: {
    hospitalCount: number;
    averageRating: number | null;
    highPriorityHospitalCount: number;
    hospitalsWithReadmissionPressure: number;
    highestOpportunityHospitals: Hospital[];
  };
  hospice: {
    providerCount: number;
    recordsReviewed: number;
    topProviders: string[];
  };
  fieldStrategy: {
    executiveView: string;
    priorityTargets: Array<{
      name: string;
      priority: string;
      opportunityScore: number;
      recommendedAngle: string;
    }>;
    coachingNotes: string[];
  };
  generatedAt: string;
};

type ApiState = {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
  analysis?: string;
  analytics?: Analytics;
  meta?: {
    mode?: string;
    model?: string;
    mcpServer?: string;
    generatedAt?: string;
  };
};

const CMS_DATASTORE_BASE = "https://data.cms.gov/provider-data/api/1/datastore/query";

const DATASETS = {
  hospitalGeneral: {
    id: "xubh-q36u",
    label: "Hospital General Information"
  },
  hospiceGeneral: {
    id: "yc9t-dgbk",
    label: "Hospice General Information"
  }
};

const STATE_MAP: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC"
};

const initialForm: FormState = {
  question:
    "Which hospitals in Brevard County may have stronger hospice education opportunity based on Medicare quality, readmission, chronic illness, and utilization signals?",
  geography: "Brevard County, Florida",
  audience: "Hospice sales leader",
  outputStyle: "Leadership ready field intelligence"
};

const sampleQuestions = [
  "Compare hospital readmission and quality signals for hospice education planning in Brevard County, Florida.",
  "Find CMS hospital quality signals that support serious illness education in Orlando, Florida.",
  "Rank hospitals in Miami Dade County, Florida by public CMS quality and readmission pressure.",
  "Create a territory opportunity view using CMS hospital ratings, readmission pressure, and hospice provider presence."
];

function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || "";
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "Not available";
  return new Intl.NumberFormat("en-US").format(value);
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function toNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === "" || value === "Not Available") return fallback;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rowValue(row: CmsRow, names: string[]) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function parseGeography(geography: string) {
  const raw = cleanString(geography);
  const lower = raw.toLowerCase();
  let state: string | null = null;

  for (const [stateName, abbr] of Object.entries(STATE_MAP)) {
    if (lower.includes(stateName)) {
      state = abbr;
      break;
    }
  }

  const stateCodeMatch = raw.match(/\b([A-Z]{2})\b/);
  if (!state && stateCodeMatch) state = stateCodeMatch[1];

  const countyMatch = raw.match(/([A-Za-z .']+)\s+County/i);
  const county = countyMatch ? countyMatch[1].trim().toUpperCase() : null;
  const zipMatch = raw.match(/\b\d{5}\b/);
  const zip = zipMatch ? zipMatch[0] : null;
  const stateNames = Object.keys(STATE_MAP).join("|");
  const cityCandidate = raw
    .replace(/\b\d{5}\b/g, "")
    .replace(/county/gi, "")
    .replace(new RegExp(stateNames, "gi"), "")
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

function filterRowsByGeography(rows: CmsRow[], geography: string) {
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

async function fetchCmsDataset(datasetId: string) {
  const pageSize = 5000;
  let offset = 0;
  const rows: CmsRow[] = [];

  for (let page = 0; page < 8; page += 1) {
    const url = `${CMS_DATASTORE_BASE}/${datasetId}/0?limit=${pageSize}&offset=${offset}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });

    if (!response.ok) {
      throw new Error(`CMS dataset ${datasetId} returned HTTP ${response.status}.`);
    }

    const json = await response.json();
    const pageRows = Array.isArray(json.results) ? json.results : [];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

function scoreHospital(row: CmsRow): Hospital {
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
    overallRating: rating || null,
    readmissionWorseCount: readmWorse,
    mortalityWorseCount: mortWorse,
    safetyWorseCount: safetyWorse,
    readmissionMeasures: readmMeasures,
    opportunityScore,
    priority: opportunityScore >= 65 ? "High" : opportunityScore >= 42 ? "Medium" : "Lower",
    rationale: [
      rating ? `CMS overall rating ${rating}` : "CMS overall rating not available",
      `${readmWorse} readmission measure group worse than average`,
      `${mortWorse} mortality measure group worse than average`,
      `${safetyWorse} safety measure group worse than average`
    ].join(". ")
  };
}

function summarizeHospiceRows(rows: CmsRow[]) {
  const names = rows.map((row) => cleanString(rowValue(row, ["provider_name", "facility_name", "hospice_name", "name"]))).filter(Boolean);
  const uniqueNames = Array.from(new Set(names));

  return {
    providerCount: uniqueNames.length || rows.length,
    recordsReviewed: rows.length,
    topProviders: uniqueNames.slice(0, 12)
  };
}

function summarizeHospitals(scoredHospitals: Hospital[]) {
  const ratingValues = scoredHospitals.map((row) => row.overallRating).filter((value): value is number => typeof value === "number" && value > 0);
  const averageRating = ratingValues.length ? Number((ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length).toFixed(2)) : null;
  const highPriority = scoredHospitals.filter((row) => row.priority === "High").length;
  const readmissionPressure = scoredHospitals.filter((row) => row.readmissionWorseCount > 0).length;

  return {
    hospitalCount: scoredHospitals.length,
    averageRating,
    highPriorityHospitalCount: highPriority,
    hospitalsWithReadmissionPressure: readmissionPressure,
    highestOpportunityHospitals: scoredHospitals.slice(0, 25)
  };
}

function buildFieldStrategy(analytics: Omit<Analytics, "fieldStrategy">) {
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
      recommendedAngle: "Lead with serious illness education, avoidable crisis reduction, goals of care clarity, family readiness, and transition support."
    })),
    coachingNotes: [
      "Use CMS signals as a market education lens, not as a patient targeting tool.",
      "Start with facilities that show readmission pressure, lower overall ratings, or multiple worse than average public quality signals.",
      "Frame outreach around earlier eligibility recognition, caregiver stress, symptom escalation, discharge planning, and goals of care clarity.",
      topNames.length ? `Highest scoring facilities: ${topNames.join(", ")}.` : "No named priority facilities were available for this geography."
    ]
  };
}

async function buildBrowserAnalytics(form: FormState): Promise<Analytics> {
  const [hospitalRows, hospiceRows] = await Promise.all([
    fetchCmsDataset(DATASETS.hospitalGeneral.id),
    fetchCmsDataset(DATASETS.hospiceGeneral.id).catch(() => [])
  ]);

  const filteredHospitals = filterRowsByGeography(hospitalRows, form.geography);
  const filteredHospice = filterRowsByGeography(hospiceRows, form.geography);
  const scoredHospitals = filteredHospitals.map(scoreHospital).sort((a, b) => b.opportunityScore - a.opportunityScore);

  const analyticsBase = {
    geography: parseGeography(form.geography),
    datasets: [
      { ...DATASETS.hospitalGeneral, recordsLoaded: hospitalRows.length, recordsMatched: filteredHospitals.length, source: "CMS Provider Data API direct browser fetch" },
      { ...DATASETS.hospiceGeneral, recordsLoaded: hospiceRows.length, recordsMatched: filteredHospice.length, source: "CMS Provider Data API direct browser fetch" }
    ],
    hospitals: summarizeHospitals(scoredHospitals),
    hospice: summarizeHospiceRows(filteredHospice),
    generatedAt: new Date().toISOString()
  };

  return {
    ...analyticsBase,
    fieldStrategy: buildFieldStrategy(analyticsBase)
  };
}

function priorityClass(priority: string) {
  if (priority === "High") return "priority high";
  if (priority === "Medium") return "priority medium";
  return "priority lower";
}

function buildLocalNarrative(analytics: Analytics) {
  const top = analytics.hospitals.highestOpportunityHospitals.slice(0, 5);
  return [
    "Executive view",
    analytics.fieldStrategy.executiveView,
    "",
    "What the CMS data shows",
    `The app loaded ${formatNumber(analytics.datasets[0]?.recordsLoaded)} hospital records from CMS Provider Data and matched ${formatNumber(analytics.hospitals.hospitalCount)} hospitals to the requested geography. Average CMS overall hospital rating for matched facilities is ${formatNumber(analytics.hospitals.averageRating)}. ${formatNumber(analytics.hospitals.hospitalsWithReadmissionPressure)} matched hospitals show at least one worse than average readmission signal.`,
    "",
    "Highest opportunity facilities",
    top.length ? top.map((hospital, index) => `${index + 1}. ${hospital.name}, ${hospital.city}, ${hospital.state}. Score ${hospital.opportunityScore}. ${hospital.rationale}.`).join("\n") : "No matched facilities were available for this geography.",
    "",
    "Hospice market context",
    `Matched hospice provider records: ${formatNumber(analytics.hospice.providerCount)}.`,
    "",
    "Compliant field conversation angles",
    analytics.fieldStrategy.coachingNotes.join("\n"),
    "",
    "Data limitations",
    "This dashboard uses public CMS Provider Data. It does not use patient level data, PHI, claim identifiers, or patient targeting. Scores are directional market education indicators, not clinical determinations or referral guarantees."
  ].join("\n");
}

export default function App() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [apiState, setApiState] = useState<ApiState>({ status: "idle" });

  const readiness = useMemo(() => {
    const values = Object.values(form);
    const filled = values.filter((value) => value.trim().length > 8).length;
    return Math.round((filled / values.length) * 100);
  }, [form]);

  const metricCards = useMemo(() => {
    const analytics = apiState.analytics;
    return [
      {
        label: "Matched hospitals",
        value: analytics ? formatNumber(analytics.hospitals.hospitalCount) : "Run analysis",
        detail: "CMS Hospital General Information records matched to the selected geography."
      },
      {
        label: "High priority hospitals",
        value: analytics ? formatNumber(analytics.hospitals.highPriorityHospitalCount) : "Pending",
        detail: "Facilities with stronger education opportunity scores."
      },
      {
        label: "Readmission pressure",
        value: analytics ? formatNumber(analytics.hospitals.hospitalsWithReadmissionPressure) : "Pending",
        detail: "Hospitals with at least one worse than average readmission signal."
      },
      {
        label: "Hospice providers",
        value: analytics ? formatNumber(analytics.hospice.providerCount) : "Pending",
        detail: "Hospice provider records matched to the same geography when available."
      }
    ];
  }, [apiState.analytics]);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function runAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiState({ status: "loading", message: "Loading public CMS Provider Data directly in the browser." });

    try {
      const analytics = await buildBrowserAnalytics(form);
      let analysis = buildLocalNarrative(analytics);
      let meta: ApiState["meta"] = {
        mode: "direct CMS browser analytics",
        generatedAt: new Date().toISOString()
      };

      const apiBaseUrl = getApiBaseUrl();
      if (apiBaseUrl) {
        try {
          const response = await fetch(`${apiBaseUrl}/api/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form)
          });
          if (response.ok) {
            const data = await response.json();
            analysis = data.analysis || analysis;
            meta = data.meta || meta;
          }
        } catch {
          meta = {
            mode: "direct CMS browser analytics",
            generatedAt: new Date().toISOString()
          };
        }
      }

      setApiState({
        status: "success",
        analysis,
        analytics,
        meta
      });
    } catch (error) {
      setApiState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "The CMS public data request failed. Check browser console network errors and confirm Hostinger is not blocking calls to data.cms.gov."
      });
    }
  }

  const analytics = apiState.analytics;
  const topHospitals = analytics?.hospitals.highestOpportunityHospitals ?? [];

  return (
    <main className="shell">
      <section className="hero panel">
        <div>
          <p className="eyebrow">Live CMS Provider Data analytics</p>
          <h1>Turn public Medicare data into a real hospice market intelligence dashboard.</h1>
          <p className="heroText">
            Search by county, city, state, or ZIP. This Vite app now loads public CMS Provider Data directly from CMS, filters the market, calculates opportunity scores, ranks hospitals, summarizes hospice provider presence, and generates a compliant field strategy.
          </p>
        </div>

        <div className="readinessCard">
          <p className="muted">Request readiness</p>
          <strong>{readiness}%</strong>
          <div className="progressTrack" aria-label="Request readiness">
            <div className="progressFill" style={{ width: `${readiness}%` }} />
          </div>
          <p className="smallText">
            Data source: CMS Provider Data API. No server is required for the base analytics dashboard.
          </p>
        </div>
      </section>

      <section className="cardGrid" aria-label="Live analytics metrics">
        {metricCards.map((card) => (
          <article className="metricCard" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.detail}</p>
          </article>
        ))}
      </section>

      <section className="workspace">
        <form className="panel formPanel" onSubmit={runAnalysis}>
          <div className="sectionHeader">
            <p className="eyebrow">Market query</p>
            <h2>Choose the market and the question.</h2>
          </div>

          <label>
            <span>Market question</span>
            <textarea
              value={form.question}
              onChange={(event) => updateField("question", event.target.value)}
              rows={7}
              placeholder="Ask a market, hospital quality, chronic condition, spending, or utilization question."
            />
          </label>

          <label>
            <span>Geography</span>
            <input
              value={form.geography}
              onChange={(event) => updateField("geography", event.target.value)}
              placeholder="Example: Brevard County, Florida, Orlando, FL, or 32937"
            />
          </label>

          <label>
            <span>Audience</span>
            <input
              value={form.audience}
              onChange={(event) => updateField("audience", event.target.value)}
              placeholder="Hospice sales leader, executive team, field rep, clinical liaison"
            />
          </label>

          <label>
            <span>Output style</span>
            <select value={form.outputStyle} onChange={(event) => updateField("outputStyle", event.target.value)}>
              <option>Leadership ready field intelligence</option>
              <option>Referral conversation coaching</option>
              <option>Territory opportunity report</option>
              <option>Hospital quality comparison</option>
              <option>Chronic condition opportunity scan</option>
            </select>
          </label>

          <div className="buttonRow">
            <button type="submit" disabled={apiState.status === "loading"}>
              {apiState.status === "loading" ? "Loading CMS data" : "Run real CMS analytics"}
            </button>
            <button type="button" className="secondaryButton" onClick={() => setForm(initialForm)}>
              Reset
            </button>
          </div>

          <div className="sampleBox">
            <strong>Sample questions</strong>
            {sampleQuestions.map((question) => (
              <button key={question} type="button" onClick={() => updateField("question", question)}>
                {question}
              </button>
            ))}
          </div>
        </form>

        <section className="panel outputPanel" aria-live="polite">
          <div className="sectionHeader">
            <p className="eyebrow">Executive output</p>
            <h2>Market intelligence result</h2>
          </div>

          {apiState.status === "idle" && (
            <div className="emptyState">
              <strong>Ready for a real CMS data pull.</strong>
              <p>
                Enter a geography and run the analysis. The dashboard will return calculated metrics, ranked hospitals, hospice provider context, and a field strategy built from public CMS data.
              </p>
            </div>
          )}

          {apiState.status === "loading" && (
            <div className="emptyState">
              <strong>Pulling CMS Provider Data.</strong>
              <p>Loading public CMS datasets, filtering the market, scoring hospitals, and building the strategy layer.</p>
            </div>
          )}

          {apiState.status === "error" && (
            <div className="errorBox">
              <strong>Analysis stopped</strong>
              <p>{apiState.message}</p>
            </div>
          )}

          {apiState.status === "success" && (
            <div className="resultStack">
              {analytics && (
                <div className="summaryBox">
                  <strong>{analytics.fieldStrategy.executiveView}</strong>
                  <p>
                    Average CMS hospital rating: {formatNumber(analytics.hospitals.averageRating)}. CMS datasets matched: {analytics.datasets.map((dataset) => `${dataset.label}: ${formatNumber(dataset.recordsMatched)}`).join(" | ")}.
                  </p>
                </div>
              )}

              {apiState.analysis && (
                <article className="analysisBox">
                  <div className="metaRow">
                    <span>{apiState.meta?.mode ?? "direct CMS analytics"}</span>
                    <span>{apiState.meta?.generatedAt ?? "Generated now"}</span>
                  </div>
                  <pre>{apiState.analysis}</pre>
                </article>
              )}
            </div>
          )}
        </section>
      </section>

      {analytics && (
        <section className="analyticsGrid">
          <article className="panel tablePanel">
            <div className="sectionHeader">
              <p className="eyebrow">Hospital rankings</p>
              <h2>Highest opportunity facilities</h2>
              <p className="mutedText">Score is calculated from CMS rating pressure, readmission pressure, mortality pressure, safety pressure, and emergency service presence.</p>
            </div>

            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Score</th>
                    <th>Priority</th>
                    <th>Facility</th>
                    <th>City</th>
                    <th>Rating</th>
                    <th>Readmission pressure</th>
                    <th>Why it scored</th>
                  </tr>
                </thead>
                <tbody>
                  {topHospitals.map((hospital) => (
                    <tr key={`${hospital.facilityId}-${hospital.name}`}>
                      <td><strong>{hospital.opportunityScore}</strong></td>
                      <td><span className={priorityClass(hospital.priority)}>{hospital.priority}</span></td>
                      <td>{hospital.name}</td>
                      <td>{hospital.city}, {hospital.state}</td>
                      <td>{hospital.overallRating ?? "N/A"}</td>
                      <td>{hospital.readmissionWorseCount}</td>
                      <td>{hospital.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel insightPanel">
            <div className="sectionHeader">
              <p className="eyebrow">Hospice context</p>
              <h2>Matched hospice providers</h2>
            </div>
            <p className="bigNumber">{formatNumber(analytics.hospice.providerCount)}</p>
            <p className="mutedText">Provider records reviewed: {formatNumber(analytics.hospice.recordsReviewed)}</p>
            <div className="providerList">
              {(analytics.hospice.topProviders.length ? analytics.hospice.topProviders : ["No hospice provider names matched this geography in the loaded CMS dataset."]).map((provider) => (
                <span key={provider}>{provider}</span>
              ))}
            </div>
          </article>

          <article className="panel insightPanel">
            <div className="sectionHeader">
              <p className="eyebrow">Coaching layer</p>
              <h2>Compliant next steps</h2>
            </div>
            <ul className="coachingList">
              {analytics.fieldStrategy.coachingNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </article>
        </section>
      )}
    </main>
  );
}
