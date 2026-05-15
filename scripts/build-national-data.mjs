import fs from "node:fs/promises";
import path from "node:path";

const CMS_DATASTORE_BASE = "https://data.cms.gov/provider-data/api/1/datastore/query";
const OUTPUT_DIR = path.join(process.cwd(), "public", "data");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "national-cms.json");

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

function cleanString(value) {
  return String(value ?? "").trim();
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "" || value === "Not Available") return fallback;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchDataset(dataset) {
  const pageSize = 5000;
  let offset = 0;
  const rows = [];

  for (let page = 0; page < 40; page += 1) {
    const url = `${CMS_DATASTORE_BASE}/${dataset.id}/0?limit=${pageSize}&offset=${offset}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });

    if (!response.ok) {
      throw new Error(`${dataset.label} returned HTTP ${response.status}`);
    }

    const json = await response.json();
    const pageRows = Array.isArray(json.results) ? json.results : [];
    rows.push(...pageRows);

    console.log(`${dataset.label}: loaded ${rows.length} rows`);

    if (pageRows.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

function compressHospital(row) {
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
    priority: opportunityScore >= 65 ? "High" : opportunityScore >= 42 ? "Medium" : "Lower"
  };
}

function compressHospice(row) {
  return {
    providerId: cleanString(row.provider_id || row.ccn || row.facility_id),
    name: cleanString(row.provider_name || row.facility_name || row.hospice_name || row.name),
    city: cleanString(row.citytown || row.city || row.provider_city),
    state: cleanString(row.state || row.state_code),
    zip: cleanString(row.zip_code || row.zip || row.provider_zip_code),
    county: cleanString(row.countyparish || row.county || row.county_name),
    ownership: cleanString(row.ownership_type || row.type_of_ownership || row.ownership)
  };
}

function buildIndexes(hospitals, hospices) {
  const states = new Map();
  const counties = new Map();

  for (const hospital of hospitals) {
    const state = hospital.state || "Unknown";
    const countyKey = `${state}|${hospital.county || "Unknown"}`;

    if (!states.has(state)) {
      states.set(state, {
        state,
        hospitals: 0,
        hospices: 0,
        highPriorityHospitals: 0,
        readmissionPressureHospitals: 0,
        ratingSum: 0,
        ratingCount: 0
      });
    }

    const stateRow = states.get(state);
    stateRow.hospitals += 1;
    if (hospital.priority === "High") stateRow.highPriorityHospitals += 1;
    if (hospital.readmissionWorseCount > 0) stateRow.readmissionPressureHospitals += 1;
    if (hospital.overallRating) {
      stateRow.ratingSum += hospital.overallRating;
      stateRow.ratingCount += 1;
    }

    if (!counties.has(countyKey)) {
      counties.set(countyKey, {
        state,
        county: hospital.county || "Unknown",
        hospitals: 0,
        hospices: 0,
        highPriorityHospitals: 0,
        readmissionPressureHospitals: 0,
        ratingSum: 0,
        ratingCount: 0
      });
    }

    const countyRow = counties.get(countyKey);
    countyRow.hospitals += 1;
    if (hospital.priority === "High") countyRow.highPriorityHospitals += 1;
    if (hospital.readmissionWorseCount > 0) countyRow.readmissionPressureHospitals += 1;
    if (hospital.overallRating) {
      countyRow.ratingSum += hospital.overallRating;
      countyRow.ratingCount += 1;
    }
  }

  for (const hospice of hospices) {
    const state = hospice.state || "Unknown";
    const countyKey = `${state}|${hospice.county || "Unknown"}`;

    if (!states.has(state)) {
      states.set(state, {
        state,
        hospitals: 0,
        hospices: 0,
        highPriorityHospitals: 0,
        readmissionPressureHospitals: 0,
        ratingSum: 0,
        ratingCount: 0
      });
    }
    states.get(state).hospices += 1;

    if (!counties.has(countyKey)) {
      counties.set(countyKey, {
        state,
        county: hospice.county || "Unknown",
        hospitals: 0,
        hospices: 0,
        highPriorityHospitals: 0,
        readmissionPressureHospitals: 0,
        ratingSum: 0,
        ratingCount: 0
      });
    }
    counties.get(countyKey).hospices += 1;
  }

  const finalize = (row) => ({
    ...row,
    averageRating: row.ratingCount ? Number((row.ratingSum / row.ratingCount).toFixed(2)) : null,
    ratingSum: undefined,
    ratingCount: undefined
  });

  return {
    states: Array.from(states.values()).map(finalize).sort((a, b) => b.highPriorityHospitals - a.highPriorityHospitals),
    counties: Array.from(counties.values()).map(finalize).sort((a, b) => b.highPriorityHospitals - a.highPriorityHospitals)
  };
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const [hospitalRows, hospiceGeneralRows, hospiceProviderRows] = await Promise.all([
    fetchDataset(DATASETS.hospitalGeneral),
    fetchDataset(DATASETS.hospiceGeneral).catch((error) => {
      console.warn(`Hospice General Information failed: ${error.message}`);
      return [];
    }),
    fetchDataset(DATASETS.hospiceProvider).catch((error) => {
      console.warn(`Hospice Provider Data failed: ${error.message}`);
      return [];
    })
  ]);

  const hospitals = hospitalRows.map(compressHospital).filter((row) => row.name);
  const hospiceSourceRows = hospiceGeneralRows.length ? hospiceGeneralRows : hospiceProviderRows;
  const hospices = hospiceSourceRows.map(compressHospice).filter((row) => row.name);
  const indexes = buildIndexes(hospitals, hospices);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "CMS Provider Data API national snapshot built during Hostinger deployment",
    datasets: {
      hospitalGeneral: { ...DATASETS.hospitalGeneral, rows: hospitals.length },
      hospiceGeneral: { ...DATASETS.hospiceGeneral, rows: hospiceGeneralRows.length },
      hospiceProvider: { ...DATASETS.hospiceProvider, rows: hospiceProviderRows.length }
    },
    hospitals,
    hospices,
    indexes
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(payload));
  console.log(`Wrote national CMS snapshot to ${OUTPUT_FILE}`);
}

main().catch(async (error) => {
  console.error(error);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(
    OUTPUT_FILE,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: "Fallback empty CMS snapshot. Build could not reach CMS Provider Data API.",
      datasets: {},
      hospitals: [],
      hospices: [],
      indexes: { states: [], counties: [] },
      error: error instanceof Error ? error.message : "Unknown CMS snapshot error"
    })
  );
  process.exitCode = 0;
});
