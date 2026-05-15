import { FormEvent, useMemo, useState } from "react";

type FormState = {
  question: string;
  geography: string;
  audience: string;
  outputStyle: string;
};

type Hospital = {
  facilityId: string;
  name: string;
  city: string;
  state: string;
  county: string;
  type: string;
  ownership: string;
  overallRating: number | null;
  readmissionWorseCount: number;
  mortalityWorseCount: number;
  safetyWorseCount: number;
  opportunityScore: number;
  priority: string;
  rationale: string;
};

type Analytics = {
  geography: {
    raw: string;
    state?: string;
    county?: string;
    city?: string;
    zip?: string;
  };
  datasets: Array<{
    id: string;
    label: string;
    recordsLoaded: number;
    recordsMatched: number;
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
    ownershipCounts: Record<string, number>;
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

const initialForm: FormState = {
  question:
    "Which hospitals in Brevard County may have stronger hospice education opportunity based on Medicare quality, readmission, chronic illness, and utilization signals?",
  geography: "Brevard County, Florida",
  audience: "Hospice sales leader",
  outputStyle: "Leadership ready field intelligence"
};

const sampleQuestions = [
  "Compare hospital readmission and quality signals for hospice education planning in Brevard County, Florida.",
  "Find Medicare chronic condition signals that may support serious illness education for referral partners in Orlando, Florida.",
  "Identify public CMS Medicare indicators that could help prioritize hospital outreach for goals of care education.",
  "Create a territory opportunity view using Medicare quality, readmission, hospice provider presence, and utilization signals."
];

function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || "";
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "Not available";
  return new Intl.NumberFormat("en-US").format(value);
}

function priorityClass(priority: string) {
  if (priority === "High") return "priority high";
  if (priority === "Medium") return "priority medium";
  return "priority lower";
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
    setApiState({ status: "loading", message: "Loading CMS Provider Data and calculating market analytics." });

    try {
      const response = await fetch(`${getApiBaseUrl()}/api/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(form)
      });

      const data = await response.json();

      if (!response.ok) {
        setApiState({
          status: "error",
          message: data.error ?? "The analysis could not be completed."
        });
        return;
      }

      setApiState({
        status: "success",
        analysis: data.analysis,
        analytics: data.analytics,
        meta: data.meta
      });
    } catch (error) {
      setApiState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "The request failed. If this is a static Hostinger deployment, make sure the Node API server is running or set VITE_API_BASE_URL to your backend URL."
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
            Search by county, city, state, or ZIP. The app now loads CMS Provider Data, filters the market, calculates opportunity scores, ranks hospitals, summarizes hospice provider presence, and generates a compliant field strategy.
          </p>
        </div>

        <div className="readinessCard">
          <p className="muted">Request readiness</p>
          <strong>{readiness}%</strong>
          <div className="progressTrack" aria-label="Request readiness">
            <div className="progressFill" style={{ width: `${readiness}%` }} />
          </div>
          <p className="smallText">
            Data source: CMS Provider Data API. Live analysis uses the Node 24 server so the OpenAI key stays private.
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
              {apiState.status === "loading" ? "Loading CMS data" : "Run real analytics"}
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
                Enter a geography and run the analysis. The dashboard will return calculated metrics, ranked hospitals, hospice provider context, and AI narrative when the OpenAI key is available.
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
                    <span>{apiState.meta?.mode ?? "cms analytics"}</span>
                    <span>{apiState.meta?.model ?? "calculated analytics"}</span>
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
