import { FormEvent, useEffect, useMemo, useState } from "react";

type Hospital = {
  facilityId: string;
  name: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  type: string;
  ownership: string;
  overallRating: number | null;
  readmissionWorseCount: number;
  mortalityWorseCount: number;
  safetyWorseCount: number;
  opportunityScore: number;
  priority: string;
};

type Hospice = {
  providerId: string;
  name: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  ownership: string;
};

type AreaIndex = {
  state: string;
  county?: string;
  hospitals: number;
  hospices: number;
  highPriorityHospitals: number;
  readmissionPressureHospitals: number;
  averageRating: number | null;
};

type Snapshot = {
  generatedAt: string;
  source: string;
  datasets: Record<string, { id: string; label: string; rows: number }>;
  hospitals: Hospital[];
  hospices: Hospice[];
  indexes: {
    states: AreaIndex[];
    counties: AreaIndex[];
  };
  error?: string;
};

type Filters = {
  geography: string;
  state: string;
  county: string;
  search: string;
  priority: string;
};

const initialFilters: Filters = {
  geography: "National",
  state: "All",
  county: "All",
  search: "",
  priority: "All"
};

const stateNames: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia"
};

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "Not available";
  return new Intl.NumberFormat("en-US").format(value);
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function priorityClass(priority: string) {
  if (priority === "High") return "priority high";
  if (priority === "Medium") return "priority medium";
  return "priority lower";
}

function inferGeography(value: string): Partial<Filters> {
  const text = normalize(value);
  if (!text || ["national", "all", "usa", "united states"].includes(text)) {
    return { state: "All", county: "All" };
  }

  const matchedState = Object.entries(stateNames).find(([code, name]) => text.includes(code.toLowerCase()) || text.includes(name.toLowerCase()));
  const countyMatch = value.match(/([A-Za-z .']+)\s+County/i);

  if (countyMatch) {
    return { state: matchedState?.[0] ?? "All", county: countyMatch[1].trim().toUpperCase() };
  }

  return matchedState ? { state: matchedState[0], county: "All" } : { state: "All", county: "All", search: value };
}

function buildNarrative(hospitals: Hospital[], hospices: Hospice[], filters: Filters) {
  const high = hospitals.filter((hospital) => hospital.priority === "High").length;
  const readmission = hospitals.filter((hospital) => hospital.readmissionWorseCount > 0).length;
  const top = hospitals.slice(0, 5);
  const market = filters.state === "All" ? "National" : `${filters.county !== "All" ? `${filters.county} County, ` : ""}${filters.state}`;

  return [
    "Executive view",
    `${market} view includes ${formatNumber(hospitals.length)} hospitals and ${formatNumber(hospices.length)} hospice provider records. ${formatNumber(high)} hospitals are scored as high opportunity based on public CMS quality pressure signals.`,
    "",
    "What the CMS data shows",
    `${formatNumber(readmission)} hospitals in the current view have at least one worse than average readmission signal. This is a market education indicator, not a referral promise or clinical determination.`,
    "",
    "Highest opportunity facilities",
    top.length ? top.map((hospital, index) => `${index + 1}. ${hospital.name}, ${hospital.city}, ${hospital.state}. Score ${hospital.opportunityScore}. CMS rating ${hospital.overallRating ?? "not available"}. Readmission pressure ${hospital.readmissionWorseCount}.`).join("\n") : "No hospitals match the current filters.",
    "",
    "Compliant field conversation angles",
    "Use this data to prioritize education around earlier eligibility recognition, caregiver stress, symptom escalation, discharge planning, serious illness conversations, and goals of care clarity. Do not use it for patient targeting, steering, inducement, or outcome guarantees.",
    "",
    "Data limitations",
    "This dashboard uses public CMS Provider Data summarized for market intelligence. It does not contain PHI, patient level claims, patient names, or individual eligibility determinations."
  ].join("\n");
}

export default function NationalDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("Loading national CMS dataset snapshot.");

  useEffect(() => {
    fetch("/data/national-cms.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load national CMS snapshot. HTTP ${response.status}`);
        return response.json();
      })
      .then((data: Snapshot) => {
        setSnapshot(data);
        setStatus(data.error ? "error" : "ready");
        setMessage(data.error || "National CMS data loaded.");
      })
      .catch((error) => {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "National CMS data could not be loaded.");
      });
  }, []);

  const states = useMemo(() => {
    if (!snapshot) return [];
    return [...new Set(snapshot.hospitals.map((hospital) => hospital.state).filter(Boolean))].sort();
  }, [snapshot]);

  const counties = useMemo(() => {
    if (!snapshot || filters.state === "All") return [];
    return [...new Set(snapshot.hospitals.filter((hospital) => hospital.state === filters.state).map((hospital) => hospital.county).filter(Boolean))].sort();
  }, [snapshot, filters.state]);

  const filteredHospitals = useMemo(() => {
    if (!snapshot) return [];
    const search = normalize(filters.search);
    return snapshot.hospitals
      .filter((hospital) => filters.state === "All" || hospital.state === filters.state)
      .filter((hospital) => filters.county === "All" || hospital.county === filters.county)
      .filter((hospital) => filters.priority === "All" || hospital.priority === filters.priority)
      .filter((hospital) => !search || `${hospital.name} ${hospital.city} ${hospital.county} ${hospital.state} ${hospital.zip} ${hospital.type} ${hospital.ownership}`.toLowerCase().includes(search))
      .sort((a, b) => b.opportunityScore - a.opportunityScore);
  }, [snapshot, filters]);

  const filteredHospices = useMemo(() => {
    if (!snapshot) return [];
    const search = normalize(filters.search);
    return snapshot.hospices
      .filter((hospice) => filters.state === "All" || hospice.state === filters.state)
      .filter((hospice) => filters.county === "All" || hospice.county === filters.county)
      .filter((hospice) => !search || `${hospice.name} ${hospice.city} ${hospice.county} ${hospice.state} ${hospice.zip} ${hospice.ownership}`.toLowerCase().includes(search));
  }, [snapshot, filters]);

  const metrics = useMemo(() => {
    const ratings = filteredHospitals.map((hospital) => hospital.overallRating).filter((rating): rating is number => typeof rating === "number");
    return {
      hospitals: filteredHospitals.length,
      hospices: filteredHospices.length,
      highPriority: filteredHospitals.filter((hospital) => hospital.priority === "High").length,
      readmissionPressure: filteredHospitals.filter((hospital) => hospital.readmissionWorseCount > 0).length,
      averageRating: ratings.length ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2)) : null
    };
  }, [filteredHospitals, filteredHospices]);

  const narrative = useMemo(() => buildNarrative(filteredHospitals, filteredHospices, filters), [filteredHospitals, filteredHospices, filters]);

  function updateFilters(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function applyGeography(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters((current) => ({ ...current, ...inferGeography(current.geography) }));
  }

  return (
    <main className="shell">
      <section className="hero panel">
        <div>
          <p className="eyebrow">Full national CMS Provider Data snapshot</p>
          <h1>National Medicare market intelligence, not a county demo.</h1>
          <p className="heroText">The app now loads a national CMS Provider Data snapshot created during deployment. Start national, then filter by state, county, ZIP, hospital name, ownership, facility type, or priority.</p>
        </div>
        <div className="readinessCard">
          <p className="muted">Dataset status</p>
          <strong>{status === "ready" ? "Live" : status === "loading" ? "Loading" : "Check"}</strong>
          <div className="progressTrack" aria-label="Dataset status"><div className="progressFill" style={{ width: status === "ready" ? "100%" : status === "loading" ? "55%" : "20%" }} /></div>
          <p className="smallText">{message}</p>
          {snapshot && <p className="smallText">Snapshot generated: {new Date(snapshot.generatedAt).toLocaleString()}</p>}
        </div>
      </section>

      <section className="cardGrid" aria-label="National analytics metrics">
        <article className="metricCard"><span>Hospitals in view</span><strong>{formatNumber(metrics.hospitals)}</strong><p>Filtered from the full national hospital dataset.</p></article>
        <article className="metricCard"><span>Hospice providers in view</span><strong>{formatNumber(metrics.hospices)}</strong><p>Filtered from national hospice provider data.</p></article>
        <article className="metricCard"><span>High opportunity hospitals</span><strong>{formatNumber(metrics.highPriority)}</strong><p>Directional public CMS education opportunity score.</p></article>
        <article className="metricCard"><span>Readmission pressure</span><strong>{formatNumber(metrics.readmissionPressure)}</strong><p>Hospitals with worse than average readmission signals.</p></article>
      </section>

      <section className="workspace">
        <form className="panel formPanel" onSubmit={applyGeography}>
          <div className="sectionHeader"><p className="eyebrow">National filter console</p><h2>Start national, then narrow the market.</h2></div>
          <label><span>Geography quick search</span><input value={filters.geography} onChange={(event) => updateFilters({ geography: event.target.value })} placeholder="National, Florida, Brevard County, Florida, Orlando, FL" /></label>
          <div className="buttonRow"><button type="submit">Apply geography</button><button type="button" className="secondaryButton" onClick={() => setFilters(initialFilters)}>Reset to national</button></div>
          <label><span>State</span><select value={filters.state} onChange={(event) => updateFilters({ state: event.target.value, county: "All" })}><option>All</option>{states.map((state) => <option key={state} value={state}>{state} {stateNames[state] ? `, ${stateNames[state]}` : ""}</option>)}</select></label>
          <label><span>County</span><select value={filters.county} onChange={(event) => updateFilters({ county: event.target.value })} disabled={filters.state === "All"}><option>All</option>{counties.map((county) => <option key={county} value={county}>{county}</option>)}</select></label>
          <label><span>Priority</span><select value={filters.priority} onChange={(event) => updateFilters({ priority: event.target.value })}><option>All</option><option>High</option><option>Medium</option><option>Lower</option></select></label>
          <label><span>Search hospitals, hospices, ZIP, city, ownership, or type</span><input value={filters.search} onChange={(event) => updateFilters({ search: event.target.value })} placeholder="Example: nonprofit, acute care, Melbourne, 32901" /></label>
        </form>

        <section className="panel outputPanel" aria-live="polite">
          <div className="sectionHeader"><p className="eyebrow">Executive output</p><h2>Market intelligence result</h2></div>
          {status === "loading" && <div className="emptyState"><strong>Loading national CMS snapshot.</strong><p>The app is loading the deployment generated data file.</p></div>}
          {status === "error" && <div className="errorBox"><strong>Dataset problem</strong><p>{message}</p></div>}
          {status === "ready" && snapshot && <div className="resultStack"><div className="summaryBox"><strong>{metrics.hospitals === snapshot.hospitals.length ? "National view active" : "Filtered market view active"}</strong><p>Average CMS hospital rating in view: {formatNumber(metrics.averageRating)}. Total national hospitals loaded: {formatNumber(snapshot.hospitals.length)}. Total national hospice records loaded: {formatNumber(snapshot.hospices.length)}.</p></div><article className="analysisBox"><div className="metaRow"><span>Static national CMS snapshot</span><span>{snapshot.source}</span></div><pre>{narrative}</pre></article></div>}
        </section>
      </section>

      {snapshot && <section className="analyticsGrid">
        <article className="panel tablePanel"><div className="sectionHeader"><p className="eyebrow">Hospital rankings</p><h2>Highest opportunity facilities in current view</h2><p className="mutedText">Score uses CMS rating pressure, readmission pressure, mortality pressure, safety pressure, facility measures, and emergency service presence.</p></div><div className="tableWrap"><table><thead><tr><th>Score</th><th>Priority</th><th>Facility</th><th>Market</th><th>Rating</th><th>Readmission</th><th>Ownership</th><th>Type</th></tr></thead><tbody>{filteredHospitals.slice(0, 100).map((hospital) => <tr key={`${hospital.facilityId}-${hospital.name}`}><td><strong>{hospital.opportunityScore}</strong></td><td><span className={priorityClass(hospital.priority)}>{hospital.priority}</span></td><td>{hospital.name}</td><td>{hospital.city}, {hospital.county}, {hospital.state}</td><td>{hospital.overallRating ?? "N/A"}</td><td>{hospital.readmissionWorseCount}</td><td>{hospital.ownership}</td><td>{hospital.type}</td></tr>)}</tbody></table></div></article>
        <article className="panel insightPanel"><div className="sectionHeader"><p className="eyebrow">National state index</p><h2>Top states by high opportunity count</h2></div><div className="providerList">{snapshot.indexes.states.slice(0, 20).map((state) => <span key={state.state}>{state.state}: {formatNumber(state.highPriorityHospitals)} high priority</span>)}</div></article>
        <article className="panel insightPanel"><div className="sectionHeader"><p className="eyebrow">Hospice context</p><h2>Hospice providers in view</h2></div><p className="bigNumber">{formatNumber(metrics.hospices)}</p><div className="providerList">{filteredHospices.slice(0, 30).map((hospice) => <span key={`${hospice.providerId}-${hospice.name}`}>{hospice.name}, {hospice.city}, {hospice.state}</span>)}{!filteredHospices.length && <span>No hospice provider records match the current filters.</span>}</div></article>
      </section>}
    </main>
  );
}
