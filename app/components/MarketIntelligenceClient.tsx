"use client";

import { FormEvent, useMemo, useState } from "react";

type FormState = {
  question: string;
  geography: string;
  audience: string;
  outputStyle: string;
};

type ApiState = {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
  analysis?: string;
  meta?: {
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
  "Create a territory opportunity view using Medicare spending, chronic condition, quality, and utilization signals."
];

const dashboardCards = [
  {
    label: "Primary source",
    value: "CMS Medicare MCP",
    detail: "Public Medicare signals through a remote MCP server."
  },
  {
    label: "Best use",
    value: "Territory planning",
    detail: "Market education, hospital outreach, and referral strategy."
  },
  {
    label: "Compliance guardrail",
    value: "No PHI",
    detail: "Blocks obvious patient identifiers before analysis."
  },
  {
    label: "Output",
    value: "Executive ready",
    detail: "Clear findings, limitations, and field next steps."
  }
];

export default function MarketIntelligenceClient() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [apiState, setApiState] = useState<ApiState>({ status: "idle" });

  const readiness = useMemo(() => {
    const values = Object.values(form);
    const filled = values.filter((value) => value.trim().length > 8).length;
    return Math.round((filled / values.length) * 100);
  }, [form]);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function runAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiState({ status: "loading", message: "Analyzing CMS Medicare signals now." });

    try {
      const response = await fetch("/api/analyze", {
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
        meta: data.meta
      });
    } catch (error) {
      setApiState({
        status: "error",
        message: error instanceof Error ? error.message : "The request failed."
      });
    }
  }

  return (
    <main className="shell">
      <section className="hero panel">
        <div>
          <p className="eyebrow">CMS Medicare intelligence for hospice strategy</p>
          <h1>Turn public Medicare data into field strategy that actually makes sense.</h1>
          <p className="heroText">
            Ask a market question, choose a geography, and generate clear outreach intelligence using public CMS Medicare signals. No patient data. No spreadsheet cave diving. No beige conference room trauma.
          </p>
        </div>

        <div className="readinessCard">
          <p className="muted">Request readiness</p>
          <strong>{readiness}%</strong>
          <div className="progressTrack" aria-label="Request readiness">
            <div className="progressFill" style={{ width: `${readiness}%` }} />
          </div>
          <p className="smallText">
            Live mode runs through a secure Next.js API route and the OpenAI Responses API with the CMS Medicare MCP server.
          </p>
        </div>
      </section>

      <section className="cardGrid" aria-label="Application capabilities">
        {dashboardCards.map((card) => (
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
            <p className="eyebrow">Ask the market</p>
            <h2>Build a focused Medicare intelligence request.</h2>
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
              placeholder="County, city, state, hospital market, or territory"
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
              {apiState.status === "loading" ? "Analyzing market" : "Generate live intelligence"}
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
            <p className="eyebrow">Output</p>
            <h2>Medicare market intelligence</h2>
          </div>

          {apiState.status === "idle" && (
            <div className="emptyState">
              <strong>Ready when you are.</strong>
              <p>
                Run the analysis to call the CMS Medicare MCP server and return public data driven field intelligence.
              </p>
            </div>
          )}

          {apiState.status === "loading" && (
            <div className="emptyState">
              <strong>Looking through the CMS Medicare signals.</strong>
              <p>This is the part where the app does the spreadsheet archaeology so you do not have to.</p>
            </div>
          )}

          {apiState.status === "error" && (
            <div className="errorBox">
              <strong>Analysis stopped</strong>
              <p>{apiState.message}</p>
            </div>
          )}

          {apiState.status === "success" && apiState.analysis && (
            <article className="analysisBox">
              <div className="metaRow">
                <span>{apiState.meta?.model ?? "Configured model"}</span>
                <span>{apiState.meta?.generatedAt ?? "Generated now"}</span>
              </div>
              <pre>{apiState.analysis}</pre>
            </article>
          )}
        </section>
      </section>
    </main>
  );
}
