import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 8787);
const CMS_DATASTORE_BASE = "https://data.cms.gov/provider-data/api/1/datastore/query";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "..", "dist");

app.use(cors());
app.use(express.json({ limit: "2mb" }));

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
  }
};

let nationalCache = null;
let nationalCacheCreatedAt = 0;
let nationalLoadPromise = null;
const CACHE_MS = 1000 * 60 * 60 * 6;

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
    id: clean(row.facility_id),
    name: clean(row.facility_name),
    city: clean(row.citytown),
    state: clean(row.state),
    zip: clean(row.zip_code),
    county: clean(row.countyparish),
    hospitalType: clean(row.hospital_type),
    ownership: clean(row.hospital_ownership),
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

function normalizeHospice(row) {
  return {
    id: clean(getField(row, ["provider_id", "facility_id", "ccn", "cms_certification_number"])),
    name: clean(getField(row, ["provider_name", "facility_name", "hospice_name", "name"])),
    city: clean(getField(row, ["citytown", "city", "provider_city"])),
    state: clean(getField(row, ["state", "state_code"])),
    zip: clean(getField(row, ["zip_code", "zip", "provider_zip_code"])),
    county: clean(getField(row, ["countyparish", "county", "county_name"])),
    ownership: clean(getField(row, ["ownership_type", "type_of_ownership", "ownership", "provider_type"]))
  };
}

async function fetchCmsDataset(dataset, maxPages = 200) {
  const pageSize = 5000;
  let offset = 0;
  const rows = [];

  for (let page = 0; page < maxPages; page += 1) {
    const url = `${CMS_DATASTORE_BASE}/${dataset.id}/0?limit=${pageSize}&offset=${offset}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });

    if (!response.ok) {
      throw new Error(`${dataset.label} returned HTTP ${response.status}`);
    }

    const json = await response.json();
    const pageRows = Array.isArray(json.results) ? json.results : [];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

function buildIndexes(hospitals, hospices) {
  const states = new Map();
  const counties = new Map();

  function ensureState(state) {
    const key = state || "Unknown";
    if (!states.has(key)) {
      states.set(key, {
        state: key,
        hospitals: 0,
        hospices: 0,
        highPriority: 0,
        readmissionPressure: 0,
        ratingSum: 0,
        ratingCount: 0
      });
    }
    return states.get(key);
  }

  function ensureCounty(state, county) {
    const key = `${state || "Unknown"}|${county || "Unknown"}`;
    if (!counties.has(key)) {
      counties.set(key, {
        state: state || "Unknown",
        county: county || "Unknown",
        hospitals: 0,
        hospices: 0,
        highPriority: 0,
        readmissionPressure: 0,
        ratingSum: 0,
        ratingCount: 0
      });
    }
    return counties.get(key);
  }

  for (const hospital of hospitals) {
    const stateRow = ensureState(hospital.state);
    const countyRow = ensureCounty(hospital.state, hospital.county);

    for (const row of [stateRow, countyRow]) {
      row.hospitals += 1;
      if (hospital.priority === "High") row.highPriority += 1;
      if (hospital.readmissionWorse > 0) row.readmissionPressure += 1;
      if (hospital.overallRating) {
        row.ratingSum += hospital.overallRating;
        row.ratingCount += 1;
      }
    }
  }

  for (const hospice of hospices) {
    ensureState(hospice.state).hospices += 1;
    ensureCounty(hospice.state, hospice.county).hospices += 1;
  }

  function finalize(row) {
    return {
      state: row.state,
      county: row.county,
      hospitals: row.hospitals,
      hospices: row.hospices,
      highPriority: row.highPriority,
      readmissionPressure: row.readmissionPressure,
      averageRating: row.ratingCount ? Number((row.ratingSum / row.ratingCount).toFixed(2)) : null
    };
  }

  return {
    states: Array.from(states.values()).map(finalize).sort((a, b) => b.highPriority - a.highPriority),
    counties: Array.from(counties.values()).map(finalize).sort((a, b) => b.highPriority - a.highPriority)
  };
}

async function buildNationalData(force = false) {
  if (!force && nationalCache && Date.now() - nationalCacheCreatedAt < CACHE_MS) {
    return nationalCache;
  }

  if (!force && nationalLoadPromise) {
    return nationalLoadPromise;
  }

  nationalLoadPromise = (async () => {
    const hospitalRows = await fetchCmsDataset(DATASETS.hospitalGeneral, 200);
    const hospitals = hospitalRows.map(scoreHospital).filter((hospital) => hospital.name);

    let hospiceRows = [];
    let hospiceDatasetUsed = DATASETS.hospiceGeneral.label;

    try {
      hospiceRows = await fetchCmsDataset(DATASETS.hospiceGeneral, 200);
    } catch (error) {
      hospiceDatasetUsed = DATASETS.hospiceProvider.label;
      hospiceRows = await fetchCmsDataset(DATASETS.hospiceProvider, 200);
    }

    const hospices = hospiceRows.map(normalizeHospice).filter((hospice) => hospice.name);
    const indexes = buildIndexes(hospitals, hospices);

    const payload = {
      ok: true,
      generatedAt: new Date().toISOString(),
      source: "Hostinger Node server CMS Provider Data cache",
      datasets: [
        { id: DATASETS.hospitalGeneral.id, label: DATASETS.hospitalGeneral.label, rows: hospitals.length },
        { label: hospiceDatasetUsed, rows: hospices.length }
      ],
      hospitals,
      hospices,
      indexes
    };

    nationalCache = payload;
    nationalCacheCreatedAt = Date.now();
    nationalLoadPromise = null;
    return payload;
  })().catch((error) => {
    nationalLoadPromise = null;
    throw error;
  });

  return nationalLoadPromise;
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "Medicare Market Intelligence API",
    hasCache: Boolean(nationalCache),
    cacheAgeSeconds: nationalCacheCreatedAt ? Math.round((Date.now() - nationalCacheCreatedAt) / 1000) : null,
    generatedAt: new Date().toISOString()
  });
});

app.get("/api/bootstrap", async (request, response) => {
  try {
    const force = request.query.refresh === "true";
    const data = await buildNationalData(force);
    response.json(data);
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown CMS data load error"
    });
  }
});

app.post("/api/refresh", async (_request, response) => {
  try {
    const data = await buildNationalData(true);
    response.json({ ok: true, generatedAt: data.generatedAt, datasets: data.datasets });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown CMS refresh error"
    });
  }
});

app.use(express.static(distDir));

app.get("*", (_request, response) => {
  response.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Medicare Market Intelligence app running on port ${port}`);
});
