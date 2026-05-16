import { FormEvent, useEffect, useMemo, useState } from "react";

type Hospital = {
  id: string;
  name: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  hospitalType: string;
  ownership: string;
  overallRating: number | null;
  readmissionWorse: number;
  mortalityWorse: number;
  safetyWorse: number;
  opportunityScore: number;
  priority: "High" | "Medium" | "Lower";
  rationale: string;
};

type Hospice = {
  id: string;
  name: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  ownership: string;
};

type DatasetStatus = {
  id?: string;
  label: string;
  rows: number;
};

type BootstrapResponse = {
  ok: boolean;
  error?: string;
  generatedAt?: string;
  source?: string;
  datasets?: DatasetStatus[];
  hospitals?: Hospital[];
  hospices?: Hospice[];
};

type Filters = {
  state: string;
  county: string;
  priority: string;
  ownership: string;
  hospitalType: string;
  search: string;
};

const DEFAULT_FILTERS: Filters = {
  state: "All",
  county: "All",
  priority: "All",
  ownership: "All",
  hospitalType: "All",
  search: ""
};

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "Not available";
  return new Intl.NumberFormat("en-US").format(value);
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!valid.length) return null;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2));
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function NationalDashboard() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [progress, setProgress] = useState("Calling Hostinger Node API at /api/bootstrap.");
  const [source, setSource] = useState("Hostinger Node API");
  const [error, setError] = useState<string | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [hospices, setHospices] = useState<Hospice[]>([]);
  const [datasetStatuses, setDatasetStatuses] = useState<DatasetStatus[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  async function loadData(refresh = false) {
    setStatus("loading");
    setError(null);
    setProgress(refresh ? "Refreshing national CMS data through Hostinger Node API." : "Loading national CMS data through Hostinger Node API.");

    try {
      const response = await fetch(`/api/bootstrap${refresh ? "?refresh=true" : ""}`, { cache: "no-store" });
      const data = (await response.json()) as BootstrapResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || `API returned HTTP ${response.status}`);
      }

      const loadedHospitals = Array.isArray(data.hospitals) ? data.hospitals : [];
      const loadedHospices = Array.isArray(data.hospices) ? data.hospices : [];

      if (!loadedHospitals.length) {
        throw new Error("The API responded successfully, but it returned zero hospital records.");
      }

      setHospitals(loadedHospitals);
      setHospices(loadedHospices);
      setDatasetStatuses(data.datasets || []);
      setSource(data.source || "Hostinger Node API CMS cache");
      setProgress(`Loaded ${formatNumber(loadedHospitals.length)} hospitals and ${formatNumber(loadedHospices.length)} hospice records.`);
      setStatus("ready");
    } catch (loadError) {
      setStatus("error");
      setError(loadError instanceof Error ? loadError.message : "Unknown API data load error.");
      setProgress("The browser could not load national data from /api/bootstrap. This means the Hostinger Node server is not running, the route is not reachable, or the server cannot reach CMS.");
    }
  }

  useEffect(() => {
    loadData(false);
  }, []);

  const states = useMemo(() => [...new Set(hospitals.map((hospital) => hospital.state).filter(Boolean))].sort(), [hospitals]);
  const counties = useMemo(() => [...new Set(hospitals.filter((hospital) => filters.state === "All" || hospital.state === filters.state).map((hospital) => hospital.county).filter(Boolean))].sort(), [hospitals, filters.state]);
  const ownerships = useMemo(() => [...new Set(hospitals.map((hospital) => hospital.ownership).filter(Boolean))].sort(), [hospitals]);
  const hospitalTypes = useMemo(() => [...new Set(hospitals.map((hospital) => hospital.hospitalType).filter(Boolean))].sort(), [hospitals]);

  const filteredHospitals = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return hospitals
      .filter((hospital) => filters.state === "All" || hospital.state === filters.state)
      .filter((hospital) => filters.county === "All" || hospital.county === filters.county)
      .filter((hospital) => filters.priority === "All" || hospital.priority === filters.priority)
      .filter((hospital) => filters.ownership === "All" || hospital.ownership === filters.ownership)
      .filter((hospital) => filters.hospitalType === "All" || hospital.hospitalType === filters.hospitalType)
      .filter((hospital) => !search || `${hospital.name} ${hospital.city} ${hospital.county} ${hospital.state} ${hospital.zip} ${hospital.ownership} ${hospital.hospitalType}`.toLowerCase().includes(search))
      .sort((a, b) => b.opportunityScore - a.opportunityScore);
  }, [hospitals, filters]);

  const filteredHospices = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return hospices
      .filter((hospice) => filters.state === "All" || hospice.state === filters.state)
      .filter((hospice) => filters.county === "All" || hospice.county === filters.county)
      .filter((hospice) => !search || `${hospice.name} ${hospice.city} ${hospice.county} ${hospice.state} ${hospice.zip} ${hospice.ownership}`.toLowerCase().includes(search));
  }, [hospices, filters]);

  const metrics = useMemo(() => ({
    hospitals: filteredHospitals.length,
    hospices: filteredHospices.length,
    highPriority: filteredHospitals.filter((hospital) => hospital.priority === "High").length,
    readmissionPressure: filteredHospitals.filter((hospital) => hospital.readmissionWorse > 0).length,
    averageRating: average(filteredHospitals.map((hospital) => hospital.overallRating))
  }), [filteredHospitals, filteredHospices]);

  function updateFilter(key: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value, ...(key === "state" ? { county: "All" } : {}) }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
  }

  return (
    <main className="shell">
      <section className="hero panel">
        <div>
          <p className="eyebrow">National CMS Provider Data</p>
          <h1>National Medicare market intelligence</h1>
          <p className="heroText">The browser now calls only your Hostinger Node API at /api/bootstrap. CMS data is loaded and cached server side.</p>
        </div>
        <div className="readinessCard">
          <p className="muted">Data status</p>
          <strong>{status === "ready" ? "Live" : status === "loading" ? "Loading" : "Failed"}</strong>
          <div className="progressTrack"><div className="progressFill" style={{ width: status === "ready" ? "100%" : status === "loading" ? "65%" : "20%" }} /></div>
          <p className="smallText">{progress}</p>
          <p className="smallText">Source: {source}</p>
          {error && <p className="smallText">Error: {error}</p>}
          <button onClick={() => loadData(true)}>Reload data</button>
        </div>
      </section>

      <section className="cardGrid">
        <article className="metricCard"><span>Hospitals in view</span><strong>{formatNumber(metrics.hospitals)}</strong><p>Filtered from national CMS hospital data.</p></article>
        <article className="metricCard"><span>Hospice records in view</span><strong>{formatNumber(metrics.hospices)}</strong><p>Filtered from national hospice data.</p></article>
        <article className="metricCard"><span>High priority hospitals</span><strong>{formatNumber(metrics.highPriority)}</strong><p>Directional public CMS education opportunity.</p></article>
        <article className="metricCard"><span>Readmission pressure</span><strong>{formatNumber(metrics.readmissionPressure)}</strong><p>Hospitals with worse than average readmission signal groups.</p></article>
      </section>

      <section className="workspace">
        <form className="panel formPanel" onSubmit={handleSubmit}>
          <div className="sectionHeader"><p className="eyebrow">Filters</p><h2>Start national, then narrow the market.</h2></div>
          <label><span>State</span><select value={filters.state} onChange={(event) => updateFilter("state", event.target.value)}><option>All</option>{states.map((state) => <option key={state}>{state}</option>)}</select></label>
          <label><span>County</span><select value={filters.county} onChange={(event) => updateFilter("county", event.target.value)} disabled={filters.state === "All"}><option>All</option>{counties.map((county) => <option key={county}>{county}</option>)}</select></label>
          <label><span>Priority</span><select value={filters.priority} onChange={(event) => updateFilter("priority", event.target.value)}><option>All</option><option>High</option><option>Medium</option><option>Lower</option></select></label>
          <label><span>Hospital type</span><select value={filters.hospitalType} onChange={(event) => updateFilter("hospitalType", event.target.value)}><option>All</option>{hospitalTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label><span>Ownership</span><select value={filters.ownership} onChange={(event) => updateFilter("ownership", event.target.value)}><option>All</option>{ownerships.map((ownership) => <option key={ownership}>{ownership}</option>)}</select></label>
          <label><span>Search</span><input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Hospital, hospice, city, ZIP, ownership, or type" /></label>
          <div className="buttonRow"><button type="button" onClick={() => setFilters(DEFAULT_FILTERS)}>Reset to national</button><button type="button" onClick={() => downloadCsv("hospitals.csv", filteredHospitals as unknown as Record<string, unknown>[])}>Export hospitals</button><button type="button" onClick={() => downloadCsv("hospices.csv", filteredHospices as unknown as Record<string, unknown>[])}>Export hospices</button></div>
        </form>

        <section className="panel outputPanel">
          <div className="sectionHeader"><p className="eyebrow">Executive view</p><h2>{filters.state === "All" ? "National market" : `${filters.county !== "All" ? `${filters.county} County, ` : ""}${filters.state}`}</h2></div>
          {status === "error" ? <div className="errorBox"><strong>Data failed to load</strong><p>{progress}</p><p>{error}</p></div> : <div className="summaryBox"><strong>{formatNumber(metrics.hospitals)} hospitals and {formatNumber(metrics.hospices)} hospice records in view.</strong><p>{formatNumber(metrics.highPriority)} high priority hospitals. {formatNumber(metrics.readmissionPressure)} hospitals with worse than average readmission pressure. Average CMS rating: {formatNumber(metrics.averageRating)}.</p></div>}
          <article className="analysisBox"><pre>{filteredHospitals.slice(0, 8).map((hospital, index) => `${index + 1}. ${hospital.name}, ${hospital.city}, ${hospital.state}. Score ${hospital.opportunityScore}. ${hospital.rationale}.`).join("\n") || "No facilities match the current filters yet."}</pre></article>
        </section>
      </section>

      <section className="analyticsGrid">
        <article className="panel tablePanel"><div className="sectionHeader"><p className="eyebrow">Hospital rankings</p><h2>Top 100 hospitals in current view</h2></div><div className="tableWrap"><table><thead><tr><th>Score</th><th>Priority</th><th>Facility</th><th>Market</th><th>Rating</th><th>Readmission</th><th>Ownership</th><th>Type</th></tr></thead><tbody>{filteredHospitals.slice(0, 100).map((hospital) => <tr key={`${hospital.id}-${hospital.name}`}><td><strong>{hospital.opportunityScore}</strong></td><td>{hospital.priority}</td><td>{hospital.name}</td><td>{hospital.city}, {hospital.county}, {hospital.state} {hospital.zip}</td><td>{hospital.overallRating ?? "N/A"}</td><td>{hospital.readmissionWorse}</td><td>{hospital.ownership}</td><td>{hospital.hospitalType}</td></tr>)}</tbody></table></div></article>
        <article className="panel insightPanel"><div className="sectionHeader"><p className="eyebrow">Hospice providers</p><h2>Top 50 in current view</h2></div><div className="providerList">{filteredHospices.slice(0, 50).map((hospice, index) => <span key={`${hospice.id}-${hospice.name}-${index}`}>{hospice.name}, {hospice.city}, {hospice.state}</span>)}{!filteredHospices.length && <span>No hospice records match the current filters.</span>}</div></article>
      </section>

      <section className="panel insightPanel"><div className="sectionHeader"><p className="eyebrow">Datasets loaded</p><h2>CMS national data sources</h2></div><div className="providerList">{datasetStatuses.map((dataset) => <span key={dataset.label}>{dataset.label}: {formatNumber(dataset.rows)} records</span>)}</div></section>
    </main>
  );
}
