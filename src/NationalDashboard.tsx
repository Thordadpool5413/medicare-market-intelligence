import { FormEvent, useEffect, useMemo, useState } from "react";

type CmsRow = Record<string, string | number | null | undefined>;

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

type Snapshot = {
  generatedAt?: string;
  source?: string;
  error?: string;
  hospitals?: unknown[];
  hospices?: unknown[];
};

type Filters = {
  state: string;
  county: string;
  priority: string;
  ownership: string;
  hospitalType: string;
  search: string;
};

const CMS_BASE = "https://data.cms.gov/provider-data/api/1/datastore/query";
const HOSPITAL_DATASET_ID = "xubh-q36u";
const HOSPICE_GENERAL_DATASET_ID = "yc9t-dgbk";
const HOSPICE_PROVIDER_DATASET_ID = "252m-zfp9";

const DEFAULT_FILTERS: Filters = {
  state: "All",
  county: "All",
  priority: "All",
  ownership: "All",
  hospitalType: "All",
  search: ""
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function numberFrom(value: unknown, fallback = 0) {
  const raw = clean(value);
  if (!raw || raw === "Not Available") return fallback;
  const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getField(row: CmsRow, names: string[]) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "Not available";
  return new Intl.NumberFormat("en-US").format(value);
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!valid.length) return null;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2));
}

function normalizeHospital(row: CmsRow): Hospital {
  const rating = numberFrom(row.hospital_overall_rating ?? row.overallRating, 0);
  const readmissionWorse = numberFrom(row.count_of_readm_measures_worse ?? row.readmissionWorseCount ?? row.readmissionWorse, 0);
  const mortalityWorse = numberFrom(row.count_of_mort_measures_worse ?? row.mortalityWorseCount ?? row.mortalityWorse, 0);
  const safetyWorse = numberFrom(row.count_of_safety_measures_worse ?? row.safetyWorseCount ?? row.safetyWorse, 0);
  const readmissionMeasures = numberFrom(row.count_of_facility_readm_measures ?? row.readmissionMeasures, 0);
  const mortalityMeasures = numberFrom(row.count_of_facility_mort_measures ?? row.mortalityMeasures, 0);
  const emergencyBoost = clean(row.emergency_services ?? row.emergencyServices).toLowerCase() === "yes" ? 5 : 0;
  const ratingPressure = rating > 0 ? (5 - rating) * 9 : 20;
  const rawScore = ratingPressure + readmissionWorse * 18 + mortalityWorse * 12 + safetyWorse * 10 + Math.min(readmissionMeasures, 11) * 1.5 + Math.min(mortalityMeasures, 8) + emergencyBoost;
  const opportunityScore = numberFrom(row.opportunityScore, Math.max(0, Math.min(100, Math.round(rawScore))));

  return {
    id: clean(row.facility_id ?? row.facilityId ?? row.id),
    name: clean(row.facility_name ?? row.name),
    city: clean(row.citytown ?? row.city),
    state: clean(row.state),
    zip: clean(row.zip_code ?? row.zip),
    county: clean(row.countyparish ?? row.county),
    hospitalType: clean(row.hospital_type ?? row.type ?? row.hospitalType),
    ownership: clean(row.hospital_ownership ?? row.ownership),
    overallRating: rating || null,
    readmissionWorse,
    mortalityWorse,
    safetyWorse,
    opportunityScore,
    priority: opportunityScore >= 65 ? "High" : opportunityScore >= 42 ? "Medium" : "Lower",
    rationale: [
      rating ? `CMS overall rating ${rating}` : "CMS overall rating unavailable",
      `${readmissionWorse} worse than average readmission group signal`,
      `${mortalityWorse} worse than average mortality group signal`,
      `${safetyWorse} worse than average safety group signal`
    ].join(". ")
  };
}

function normalizeHospice(row: CmsRow): Hospice {
  return {
    id: clean(getField(row, ["provider_id", "facility_id", "ccn", "cms_certification_number", "providerId", "id"])),
    name: clean(getField(row, ["provider_name", "facility_name", "hospice_name", "name"])),
    city: clean(getField(row, ["citytown", "city", "provider_city"])),
    state: clean(getField(row, ["state", "state_code"])),
    zip: clean(getField(row, ["zip_code", "zip", "provider_zip_code"])),
    county: clean(getField(row, ["countyparish", "county", "county_name"])),
    ownership: clean(getField(row, ["ownership_type", "type_of_ownership", "ownership", "provider_type"]))
  };
}

async function fetchCmsDataset(datasetId: string, label: string, onProgress: (message: string) => void) {
  const pageSize = 5000;
  let offset = 0;
  const rows: CmsRow[] = [];

  for (let page = 0; page < 120; page += 1) {
    const url = `${CMS_BASE}/${datasetId}/0?limit=${pageSize}&offset=${offset}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    const json = await response.json();
    const pageRows = Array.isArray(json.results) ? json.results : [];
    rows.push(...pageRows);
    onProgress(`${label}: loaded ${formatNumber(rows.length)} rows`);
    if (pageRows.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

async function loadSnapshot() {
  const response = await fetch(`/data/national-cms.json?cacheBust=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`/data/national-cms.json returned HTTP ${response.status}`);
  const snapshot = (await response.json()) as Snapshot;
  if (snapshot.error) throw new Error(snapshot.error);
  const hospitals = Array.isArray(snapshot.hospitals) ? snapshot.hospitals.map((row) => normalizeHospital(row as CmsRow)).filter((row) => row.name) : [];
  const hospices = Array.isArray(snapshot.hospices) ? snapshot.hospices.map((row) => normalizeHospice(row as CmsRow)).filter((row) => row.name) : [];
  if (!hospitals.length) throw new Error("The national snapshot loaded, but it did not contain hospital records.");
  return { hospitals, hospices, source: snapshot.source || "Local national CMS snapshot" };
}

async function loadLiveCms(onProgress: (message: string) => void) {
  const hospitalRows = await fetchCmsDataset(HOSPITAL_DATASET_ID, "Hospital General Information", onProgress);
  let hospiceRows: CmsRow[] = [];

  try {
    hospiceRows = await fetchCmsDataset(HOSPICE_GENERAL_DATASET_ID, "Hospice General Information", onProgress);
  } catch {
    hospiceRows = await fetchCmsDataset(HOSPICE_PROVIDER_DATASET_ID, "Hospice Provider Data", onProgress);
  }

  return {
    hospitals: hospitalRows.map(normalizeHospital).filter((row) => row.name),
    hospices: hospiceRows.map(normalizeHospice).filter((row) => row.name),
    source: "Live CMS Provider Data API fallback"
  };
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
  const [progress, setProgress] = useState("Loading local national CMS snapshot.");
  const [source, setSource] = useState("Not loaded yet");
  const [error, setError] = useState<string | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [hospices, setHospices] = useState<Hospice[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  async function loadData() {
    setStatus("loading");
    setError(null);
    setProgress("Trying local national CMS snapshot first.");

    try {
      const localData = await loadSnapshot();
      setHospitals(localData.hospitals);
      setHospices(localData.hospices);
      setSource(localData.source);
      setProgress(`Loaded ${formatNumber(localData.hospitals.length)} hospitals from local national snapshot.`);
      setStatus("ready");
      return;
    } catch (snapshotError) {
      setProgress(`Local snapshot unavailable. Trying live CMS fallback. ${snapshotError instanceof Error ? snapshotError.message : "Unknown snapshot error"}`);
    }

    try {
      const liveData = await loadLiveCms(setProgress);
      setHospitals(liveData.hospitals);
      setHospices(liveData.hospices);
      setSource(liveData.source);
      setProgress(`Loaded ${formatNumber(liveData.hospitals.length)} hospitals from live CMS fallback.`);
      setStatus("ready");
    } catch (liveError) {
      setStatus("error");
      setError(liveError instanceof Error ? liveError.message : "Unable to load CMS data.");
      setProgress("Data failed to load. Hostinger needs either the generated national snapshot at /data/national-cms.json or a working CMS network connection.");
    }
  }

  useEffect(() => {
    loadData();
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
          <p className="heroText">The app now tries the generated national snapshot first, then falls back to live CMS Provider Data if the snapshot is missing.</p>
        </div>
        <div className="readinessCard">
          <p className="muted">Data status</p>
          <strong>{status === "ready" ? "Live" : status === "loading" ? "Loading" : "Failed"}</strong>
          <div className="progressTrack"><div className="progressFill" style={{ width: status === "ready" ? "100%" : status === "loading" ? "65%" : "20%" }} /></div>
          <p className="smallText">{progress}</p>
          <p className="smallText">Source: {source}</p>
          {error && <p className="smallText">Error: {error}</p>}
          <button onClick={loadData}>Reload data</button>
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
    </main>
  );
}
