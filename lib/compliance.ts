export type ComplianceCheck = {
  ok: boolean;
  message?: string;
};

const riskyPatterns = [
  { name: "Social Security number", pattern: /\b\d{3}\s?\d{2}\s?\d{4}\b/i },
  { name: "medical record number", pattern: /\b(mrn|medical record|record number|patient id|claim id)\b/i },
  { name: "date of birth", pattern: /\b(dob|date of birth)\b/i },
  { name: "direct patient reference", pattern: /\b(patient name|named patient|specific patient)\b/i }
];

export function checkForPatientIdentifiers(value: string): ComplianceCheck {
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
