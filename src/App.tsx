import { Component, type ErrorInfo, type ReactNode } from "react";
import NationalDashboard from "./NationalDashboard";

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: ""
  };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown front end error"
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App crashed", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="shell">
          <section className="panel hero">
            <div>
              <p className="eyebrow">Application setup issue</p>
              <h1>The app loaded, but the dashboard crashed before it could render.</h1>
              <p className="heroText">This usually means a missing Hostinger environment variable, a Supabase configuration issue, or a deployment using an old build.</p>
            </div>
            <div className="readinessCard">
              <p className="muted">Error</p>
              <strong>Front end crash</strong>
              <p className="smallText">{this.state.message}</p>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <NationalDashboard />
    </ErrorBoundary>
  );
}
