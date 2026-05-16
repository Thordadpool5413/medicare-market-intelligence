import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfig } from "./lib/supabase";

type Hospital = {
  facility_id: string;
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  hospital_type: string | null;
  ownership: string | null;
  overall_rating: number | null;
  readmission_worse_count: number | null;
  mortality_worse_count: number | null;
  safety_worse_count: number | null;
  opportunity_score: number | null;
  priority: string | null;
  rationale: string | null;
};

type Hospice = {
  provider_key: string;
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  ownership: string | null;
};

type IngestionRun = {
  id: number;
  source: string;
  status: string;
  hospital_rows: number | null;
  hospice_rows: number | null;
  message: string | null;
  finished_at: string | null;
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

const PAGE_SIZE = 100;

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "Not available";
  return new Intl.NumberFormat("en-US").format(value);
}

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!valid.length) return null;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2));
}

function csvDownload(filename: string, rows: Record<string, unknown>[]) {
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

function setupCard(title: string, message: string, details: string[]) {
  return (
    <main className="shell">
      <section className="hero panel">
        <div>
          <p className="eyebrow">Supabase setup required</p>
          <h1>{title}</h1>
          <p className="heroText">{message}</p>
        </div>
        <div className="readinessCard">
          <p className="muted">What to check</p>
          <strong>Configuration</strong>
          {details.map((detail) => <p className="smallText" key={detail}>{detail}</p>)}
        </div>
      </section>
    </main>
  );
}

function applyHospitalFilters(query: any, filters: Filters) {
  let next = query;
  if (filters.state !== "All") next = next.eq("state", filters.state);
  if (filters.county !== "All") next = next.eq("county", filters.county);
  if (filters.priority !== "All") next = next.eq("priority", filters.priority);
  if (filters.ownership !== "All") next = next.eq("ownership", filters.ownership);
  if (filters.hospitalType !== "All") next = next.eq("hospital_type", filters.hospitalType);
  if (filters.search.trim()) {
    const value = `%${filters.search.trim()}%`;
    next = next.or(`name.ilike.${value},city.ilike.${value},county.ilike.${value},zip.ilike.${value},ownership.ilike.${value},hospital_type.ilike.${value}`);
  }
  return next;
}

function applyHospiceFilters(query: any, filters: Filters) {
  let next = query;
  if (filters.state !== "All") next = next.eq("state", filters.state);
  if (filters.county !== "All") next = next.eq("county", filters.county);
  if (filters.search.trim()) {
    const value = `%${filters.search.trim()}%`;
    next = next.or(`name.ilike.${value},city.ilike.${value},county.ilike.${value},zip.ilike.${value},ownership.ilike.${value}`);
  }
  return next;
}

export default function NationalDashboard() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [hospices, setHospices] = useState<Hospice[]>([]);
  const [hospitalCount, setHospitalCount] = useState(0);
  const [hospiceCount, setHospiceCount] = useState(0);
  const [nationalHospitalCount, setNationalHospitalCount] = useState(0);
  const [nationalHospiceCount, setNationalHospiceCount] = useState(0);
  const [states, setStates] = useState<string[]>([]);
  const [counties, setCounties] = useState<string[]>([]);
  const [ownerships, setOwnerships] = useState<string[]>([]);
  const [hospitalTypes, setHospitalTypes] = useState<string[]>([]);
  const [lastRun, setLastRun] = useState<IngestionRun | null>(null);

  async function loadOptions() {
    if (!supabase) throw new Error("Supabase client is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Hostinger, then rebuild.");

    const [stateResult, ownershipResult, typeResult, hospitalTotal, hospiceTotal, runResult] = await Promise.all([
      supabase.from("cms_hospitals").select("state").not("state", "is", null).order("state"),
      supabase.from("cms_hospitals").select("ownership").not("ownership", "is", null).order("ownership"),
      supabase.from("cms_hospitals").select("hospital_type").not("hospital_type", "is", null).order("hospital_type"),
      supabase.from("cms_hospitals").select("facility_id", { count: "exact", head: true }),
      supabase.from("cms_hospices").select("provider_key", { count: "exact", head: true }),
      supabase.from("cms_ingestion_runs").select("*").order("id", { ascending: false }).limit(1)
    ]);

    if (stateResult.error) throw stateResult.error;
    if (ownershipResult.error) throw ownershipResult.error;
    if (typeResult.error) throw typeResult.error;
    if (hospitalTotal.error) throw hospitalTotal.error;
    if (hospiceTotal.error) throw hospiceTotal.error;
    if (runResult.error) throw runResult.error;

    setStates([...new Set((stateResult.data || []).map((row: any) => row.state).filter(Boolean))]);
    setOwnerships([...new Set((ownershipResult.data || []).map((row: any) => row.ownership).filter(Boolean))]);
    setHospitalTypes([...new Set((typeResult.data || []).map((row: any) => row.hospital_type).filter(Boolean))]);
    setNationalHospitalCount(hospitalTotal.count || 0);
    setNationalHospiceCount(hospiceTotal.count || 0);
    setLastRun((runResult.data || [])[0] || null);
  }

  async function loadCounties(selectedState: string) {
    if (!supabase) throw new Error("Supabase client is not configured.");
    if (selectedState === "All") {
      setCounties([]);
      return;
    }
    const { data, error: countyError } = await supabase.from("cms_hospitals").select("county").eq("state", selectedState).not("county", "is", null).order("county");
    if (countyError) throw countyError;
    setCounties([...new Set((data || []).map((row: any) => row.county).filter(Boolean))]);
  }

  async function loadData() {
    if (!supabaseConfig.isConfigured || !supabase) {
      setStatus("error");
      setError("Missing Supabase browser variables. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Hostinger, then rebuild the Vite app.");
      return;
    }

    setStatus("loading");
    setError(null);

    try {
      await loadOptions();
      await loadCounties(filters.state);

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const hospitalQuery = applyHospitalFilters(
        supabase
          .from("cms_hospitals")
          .select("facility_id,name,city,state,zip,county,hospital_type,ownership,overall_rating,readmission_worse_count,mortality_worse_count,safety_worse_count,opportunity_score,priority,rationale", { count: "exact" }),
        filters
      )
        .order("opportunity_score", { ascending: false })
        .range(from, to);

      const hospiceQuery = applyHospiceFilters(
        supabase
          .from("cms_hospices")
          .select("provider_key,name,city,state,zip,county,ownership", { count: "exact" }),
        filters
      )
        .order("name", { ascending: true })
        .range(0, 49);

      const [hospitalResult, hospiceResult] = await Promise.all([hospitalQuery, hospiceQuery]);

      if (hospitalResult.error) throw hospitalResult.error;
      if (hospiceResult.error) throw hospiceResult.error;

      setHospitals((hospitalResult.data || []) as Hospital[]);
      setHospices((hospiceResult.data || []) as Hospice[]);
      setHospitalCount(hospitalResult.count || 0);
      setHospiceCount(hospiceResult.count || 0);
      setStatus("ready");
    } catch (loadError) {
      setStatus("error");
      setError(loadError instanceof Error ? loadError.message : "Unable to load Supabase data.");
    }
  }

  useEffect(() => {
    loadData();
  }, [filters, page]);

  function updateFilter(key: keyof Filters, value: string) {
    setPage(0);
    setFilters((current) => ({ ...current, [key]: value, ...(key === "state" ? { county: "All" } : {}) }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPage(0);
    loadData();
  }

  const metrics = useMemo(() => ({
    hospitals: hospitalCount,
    hospices: hospiceCount,
    highPriorityOnPage: hospitals.filter((hospital) => hospital.priority === "High").length,
    readmissionOnPage: hospitals.filter((hospital) => Number(hospital.readmission_worse_count || 0) > 0).length,
    averageRatingOnPage: average(hospitals.map((hospital) => hospital.overall_rating))
  }), [hospitalCount, hospiceCount, hospitals]);

  const pageCount = Math.max(1, Math.ceil(hospitalCount / PAGE_SIZE));

  async function exportCurrentHospitals() {
    if (!supabase) {
      setError("Supabase is not configured, so export cannot run.");
      return;
    }

    const { data, error: exportError } = await applyHospitalFilters(
      supabase.from("cms_hospitals").select("facility_id,name,city,state,zip,county,hospital_type,ownership,overall_rating,readmission_worse_count,mortality_worse_count,safety_worse_count,opportunity_score,priority,rationale"),
      filters
    )
      .order("opportunity_score", { ascending: false })
      .limit(5000);

    if (exportError) {
      setError(exportError.message);
      return;
    }

    csvDownload("cms-hospitals-current-view.csv", (data || []) as unknown as Record<string, unknown>[]);
  }

  if (!supabaseConfig.isConfigured) {
    return setupCard(
      "The dashboard is installed, but Supabase is not configured yet.",
      "Hostinger built the Vite app without the required Supabase browser variables. Add the two VITE variables in Hostinger, then redeploy.",
      [
        "Add VITE_SUPABASE_URL in Hostinger.",
        "Add VITE_SUPABASE_ANON_KEY in Hostinger.",
        "Redeploy using npm run build and output directory dist.",
        "Run the GitHub Actions ingestion workflow after Supabase schema is created."
      ]
    );
  }

  return (
    <main className="shell">
      <section className="hero panel">
        <div>
          <p className="eyebrow">Supabase national CMS backend</p>
          <h1>National Medicare market intelligence</h1>
          <p className="heroText">Hostinger serves the Vite app. Supabase stores the national CMS hospital and hospice data. The dashboard now renders setup and data errors instead of going blank.</p>
        </div>
        <div className="readinessCard">
          <p className="muted">Data status</p>
          <strong>{status === "ready" ? "Live" : status === "loading" ? "Loading" : "Error"}</strong>
          <div className="progressTrack"><div className="progressFill" style={{ width: status === "ready" ? "100%" : status === "loading" ? "60%" : "20%" }} /></div>
          <p className="smallText">National hospitals in Supabase: {formatNumber(nationalHospitalCount)}</p>
          <p className="smallText">National hospice records in Supabase: {formatNumber(nationalHospiceCount)}</p>
          {lastRun && <p className="smallText">Last ingestion: {lastRun.status}. {lastRun.message}</p>}
          {error && <p className="smallText">Error: {error}</p>}
        </div>
      </section>

      <section className="cardGrid">
        <article className="metricCard"><span>Hospitals in view</span><strong>{formatNumber(metrics.hospitals)}</strong><p>Filtered from Supabase CMS hospital records.</p></article>
        <article className="metricCard"><span>Hospice records in view</span><strong>{formatNumber(metrics.hospices)}</strong><p>Filtered from Supabase hospice records.</p></article>
        <article className="metricCard"><span>High priority on page</span><strong>{formatNumber(metrics.highPriorityOnPage)}</strong><p>Top scoring visible records.</p></article>
        <article className="metricCard"><span>Average rating on page</span><strong>{formatNumber(metrics.averageRatingOnPage)}</strong><p>Visible CMS overall hospital rating average.</p></article>
      </section>

      <section className="workspace">
        <form className="panel formPanel" onSubmit={handleSubmit}>
          <div className="sectionHeader"><p className="eyebrow">Filters</p><h2>Start national, then drill down.</h2></div>
          <label><span>State</span><select value={filters.state} onChange={(event) => updateFilter("state", event.target.value)}><option>All</option>{states.map((state) => <option key={state}>{state}</option>)}</select></label>
          <label><span>County</span><select value={filters.county} onChange={(event) => updateFilter("county", event.target.value)} disabled={filters.state === "All"}><option>All</option>{counties.map((county) => <option key={county}>{county}</option>)}</select></label>
          <label><span>Priority</span><select value={filters.priority} onChange={(event) => updateFilter("priority", event.target.value)}><option>All</option><option>High</option><option>Medium</option><option>Lower</option></select></label>
          <label><span>Hospital type</span><select value={filters.hospitalType} onChange={(event) => updateFilter("hospitalType", event.target.value)}><option>All</option>{hospitalTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label><span>Ownership</span><select value={filters.ownership} onChange={(event) => updateFilter("ownership", event.target.value)}><option>All</option>{ownerships.map((ownership) => <option key={ownership}>{ownership}</option>)}</select></label>
          <label><span>Search</span><input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Hospital, hospice, city, ZIP, ownership, or type" /></label>
          <div className="buttonRow"><button type="button" onClick={() => { setFilters(DEFAULT_FILTERS); setPage(0); }}>Reset to national</button><button type="button" onClick={exportCurrentHospitals}>Export hospitals</button></div>
        </form>

        <section className="panel outputPanel">
          <div className="sectionHeader"><p className="eyebrow">Executive view</p><h2>{filters.state === "All" ? "National market" : `${filters.county !== "All" ? `${filters.county} County, ` : ""}${filters.state}`}</h2></div>
          {status === "error" ? <div className="errorBox"><strong>Supabase data failed to load</strong><p>{error}</p></div> : <div className="summaryBox"><strong>{formatNumber(metrics.hospitals)} hospitals and {formatNumber(metrics.hospices)} hospice records in view.</strong><p>This view is served from Supabase tables, not CMS browser fetches or Hostinger Node routes.</p></div>}
          <article className="analysisBox"><pre>{hospitals.slice(0, 8).map((hospital, index) => `${index + 1}. ${hospital.name}, ${hospital.city}, ${hospital.state}. Score ${hospital.opportunity_score}. ${hospital.rationale}.`).join("\n") || "No hospital records match the current filters. Confirm Supabase has been ingested."}</pre></article>
        </section>
      </section>

      <section className="analyticsGrid">
        <article className="panel tablePanel"><div className="sectionHeader"><p className="eyebrow">Hospital rankings</p><h2>Hospital records</h2><p className="mutedText">Page {page + 1} of {pageCount}. Showing {PAGE_SIZE} records per page.</p></div><div className="tableWrap"><table><thead><tr><th>Score</th><th>Priority</th><th>Facility</th><th>Market</th><th>Rating</th><th>Readmission</th><th>Ownership</th><th>Type</th></tr></thead><tbody>{hospitals.map((hospital) => <tr key={hospital.facility_id}><td><strong>{hospital.opportunity_score}</strong></td><td>{hospital.priority}</td><td>{hospital.name}</td><td>{hospital.city}, {hospital.county}, {hospital.state} {hospital.zip}</td><td>{hospital.overall_rating ?? "N/A"}</td><td>{hospital.readmission_worse_count}</td><td>{hospital.ownership}</td><td>{hospital.hospital_type}</td></tr>)}</tbody></table></div><div className="buttonRow"><button type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button><button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button></div></article>
        <article className="panel insightPanel"><div className="sectionHeader"><p className="eyebrow">Hospice providers</p><h2>Top 50 in current view</h2></div><div className="providerList">{hospices.map((hospice) => <span key={hospice.provider_key}>{hospice.name}, {hospice.city}, {hospice.state}</span>)}{!hospices.length && <span>No hospice records match the current filters.</span>}</div></article>
      </section>
    </main>
  );
}
