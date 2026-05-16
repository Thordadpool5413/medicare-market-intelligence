import { createClient } from "@supabase/supabase-js";

const CMS_BASE = "https://data.cms.gov/provider-data/api/1/datastore/query";

const DATASETS = {
  hospitalGeneral: { id: "xubh-q36u", label: "Hospital General Information" },
  hospiceGeneral: { id: "yc9t-dgbk", label: "Hospice General Information" },
  hospiceProvider: { id: "252m-zfp9", label: "Hospice Provider Data" }
};

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const elevatedKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !elevatedKey) {
  console.error("Missing SUPABASE_URL and/or SUPABASE_SECRET_KEY. Use the Supabase Secret key, usually formatted like sb_secret_...");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, elevatedKey, {
  auth: { persistSession: false }
});

function clean(value) {
  return String(value ?? "").trim();
}

function numberFrom(value, fallback = 0) {
  const raw = clean(value);
  if (!raw || raw === "Not Available") return fallback;
  const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getField(row, names) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function scoreHospital(row) {
  const rating = numberFrom(row.hospital_overall_rating, 0);
  const readmissionWorse = numberFrom(row.count_of_readm_measures_worse, 0);
  const mortalityWorse = numberFrom(row.count_of_mort_measures_worse, 0);
  const safetyWorse = numberFrom(row.count_of_safety_measures_worse, 0);
  const readmissionMeasures = numberFrom(row.count_of_facility_readm_measures, 0);
  const mortalityMeasures = numberFrom(row.count_of_facility_mort_measures, 0);
  const emergencyBoost = clean(row.emergency_services).toLowerCase() === "yes" ? 5 : 0;
  const ratingPressure = rating > 0 ? (5 - rating) * 9 : 20;
  const rawScore = ratingPressure + readmissionWorse * 18 + mortalityWorse * 12 + safetyWorse * 10 + Math.min(readmissionMeasures, 11) * 1.5 + Math.min(mortalityMeasures, 8) + emergencyBoost;
  const opportunityScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    facility_id: clean(row.facility_id),
    name: clean(row.facility_name),
    address: clean(row.address),
    city: clean(row.citytown),
    state: clean(row.state),
    zip: clean(row.zip_code),
    county: clean(row.countyparish),
    phone: clean(row.telephone_number),
    hospital_type: clean(row.hospital_type),
    ownership: clean(row.hospital_ownership),
    emergency_services: clean(row.emergency_services),
    overall_rating: rating || null,
    readmission_worse_count: readmissionWorse,
    mortality_worse_count: mortalityWorse,
    safety_worse_count: safetyWorse,
    readmission_measures: readmissionMeasures,
    mortality_measures: mortalityMeasures,
    opportunity_score: opportunityScore,
    priority: opportunityScore >= 65 ? "High" : opportunityScore >= 42 ? "Medium" : "Lower",
    rationale: [
      rating ? `CMS overall rating ${rating}` : "CMS overall rating unavailable",
      `${readmissionWorse} worse than average readmission group signal`,
      `${mortalityWorse} worse than average mortality group signal`,
      `${safetyWorse} worse than average safety group signal`
    ].join(". "),
    raw: row,
    updated_at: new Date().toISOString()
  };
}

function normalizeHospice(row, index) {
  const providerId = clean(getField(row, ["provider_id", "facility_id", "ccn", "cms_certification_number"]));
  const name = clean(getField(row, ["provider_name", "facility_name", "hospice_name", "name"]));
  const state = clean(getField(row, ["state", "state_code"]));
  const zip = clean(getField(row, ["zip_code", "zip", "provider_zip_code"]));
  const city = clean(getField(row, ["citytown", "city", "provider_city"]));
  const providerKey = providerId || `${name}|${city}|${state}|${zip}|${index}`;

  return {
    provider_key: providerKey,
    name,
    city,
    state,
    zip,
    county: clean(getField(row, ["countyparish", "county", "county_name"])),
    ownership: clean(getField(row, ["ownership_type", "type_of_ownership", "ownership", "provider_type"])),
    raw: row,
    updated_at: new Date().toISOString()
  };
}

async function fetchCmsDataset(dataset, maxPages = 250) {
  const pageSize = 5000;
  let offset = 0;
  const rows = [];

  for (let page = 0; page < maxPages; page += 1) {
    const url = `${CMS_BASE}/${dataset.id}/0?limit=${pageSize}&offset=${offset}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });

    if (!response.ok) {
      throw new Error(`${dataset.label} returned HTTP ${response.status}`);
    }

    const json = await response.json();
    const pageRows = Array.isArray(json.results) ? json.results : [];
    rows.push(...pageRows);
    console.log(`${dataset.label}: ${rows.length} rows loaded`);

    if (pageRows.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

async function upsertInBatches(table, rows, conflictColumn) {
  const batchSize = 500;
  let completed = 0;

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: conflictColumn });

    if (error) {
      throw new Error(`${table} upsert failed: ${error.message}`);
    }

    completed += batch.length;
    console.log(`${table}: ${completed}/${rows.length} upserted`);
  }
}

async function createRun(status, message = "") {
  const { data, error } = await supabase
    .from("cms_ingestion_runs")
    .insert({ source: "CMS Provider Data API", status, message })
    .select("id")
    .single();

  if (error) {
    console.warn(`Unable to create ingestion run: ${error.message}`);
    return null;
  }

  return data.id;
}

async function finishRun(id, status, hospitalRows, hospiceRows, message) {
  if (!id) return;
  const { error } = await supabase
    .from("cms_ingestion_runs")
    .update({ status, hospital_rows: hospitalRows, hospice_rows: hospiceRows, message, finished_at: new Date().toISOString() })
    .eq("id", id);

  if (error) console.warn(`Unable to finish ingestion run: ${error.message}`);
}

async function main() {
  const runId = await createRun("running", "CMS national ingestion started.");

  try {
    const hospitalRows = await fetchCmsDataset(DATASETS.hospitalGeneral);
    const hospitals = hospitalRows.map(scoreHospital).filter((row) => row.facility_id && row.name);

    let hospiceRows = [];
    try {
      hospiceRows = await fetchCmsDataset(DATASETS.hospiceGeneral);
    } catch (error) {
      console.warn(`Hospice General Information failed. Trying Hospice Provider Data. ${error.message}`);
      hospiceRows = await fetchCmsDataset(DATASETS.hospiceProvider);
    }

    const hospices = hospiceRows.map(normalizeHospice).filter((row) => row.provider_key && row.name);

    await upsertInBatches("cms_hospitals", hospitals, "facility_id");
    await upsertInBatches("cms_hospices", hospices, "provider_key");
    await finishRun(runId, "completed", hospitals.length, hospices.length, "CMS national ingestion completed.");

    console.log(`Done. Hospitals: ${hospitals.length}. Hospices: ${hospices.length}.`);
  } catch (error) {
    await finishRun(runId, "failed", 0, 0, error instanceof Error ? error.message : "Unknown ingestion failure");
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
