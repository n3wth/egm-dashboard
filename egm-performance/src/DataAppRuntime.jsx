import React, { useEffect, useState } from "react";

import { DataAppShell } from "./DataAppShell.jsx";
import { loadHostedSnapshot } from "./hosted-query-bootstrap.js";
import { createQueryDataStore } from "./query-data-store.js";
import { DataAppLoadingContent } from "./components/DataAppLoadingContent.jsx";

function DataAppLoading() {
  return (
    <main className="dashboard-shell-loading" aria-busy="true">
      <div className="dashboard-shell-loading-topbar" aria-hidden="true">
        <div className="dashboard-shell-loading-brand"><div className="dashboard-shell-loading-line is-logo"/><div className="dashboard-shell-loading-line is-brand" /></div>
        <div className="dashboard-shell-loading-nav">{Array.from({length:7},(_,index)=><div key={index} className="dashboard-shell-loading-line is-nav-icon"/>)}</div>
        <div className="dashboard-shell-loading-actions"><div className="dashboard-shell-loading-line is-nav-icon"/><div className="dashboard-shell-loading-line is-avatar"/></div>
      </div>
      <DataAppLoadingContent />
    </main>
  );
}

function DataAppLoadError({ error, onRetry }) {
  const offline = globalThis.navigator?.onLine === false;
  return (
    <main className="dashboard-shell-loading-error" role="alert" aria-labelledby="data-app-load-error-title">
      <section className="dashboard-shell-error-card">
        <h1 id="data-app-load-error-title" className="dashboard-shell-error-title">Couldn’t load the dashboard</h1>
        <p className="dashboard-shell-error-copy">{offline
          ? "You appear to be offline. The dashboard will try again when your connection returns."
          : "The dashboard data didn’t arrive. This is usually temporary, so try again in a moment. If your session expired, reloading the page signs you back in."}</p>
        {error?.message && <p className="dashboard-shell-error-detail">{error.message}</p>}
        <div className="dashboard-shell-error-actions">
          <button type="button" className="button primary" onClick={onRetry}>Try again</button>
          <button type="button" className="button ghost" onClick={() => globalThis.location?.reload()}>Reload page</button>
        </div>
      </section>
    </main>
  );
}


// The protected runtime accepts authored content and reviewed data at its boundary.
// Neither the source-build wrapper nor the prebuilt browser bundle owns a second
// copy of the shell, its contexts, or the hosted permission/fetch behavior.
export function DataAppRuntime({
  reviewedSnapshot,
  createContent,
  DashboardContent,
  ReportContent,
  staticDemo = false,
  hosted = globalThis.location?.hostname.endsWith(".chatgpt.site") ?? false,
} = {}) {
  const [snapshot, setSnapshot] = useState(hosted ? null : reviewedSnapshot);
  const [presentationRecord, setPresentationRecord] = useState({ presentation: {}, revision: 0 });
  const [error, setError] = useState(null);
  const [queryDataStore, setQueryDataStore] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setError(null);
    setAttempt(value => value + 1);
  };

  useEffect(() => {
    if (!error) return undefined;
    globalThis.addEventListener?.("online", retry);
    return () => globalThis.removeEventListener?.("online", retry);
  }, [error]);

  useEffect(() => {
    if (!hosted) return;
    const controller = new AbortController();
    let active = true;
    let store;
    Promise.all([
      loadHostedSnapshot(reviewedSnapshot, { signal: controller.signal }),
      fetch("/api/presentation", { signal: controller.signal }).then(response => {
        if (!response.ok) throw new Error("Data app presentation is unavailable.");
        return response.json();
      }),
    ])
      .then(([{ snapshot: snapshotValue, deferred }, record]) => {
        if (!active) return;
        if (deferred) {
          store = createQueryDataStore(snapshotValue, {
            snapshotSha256: snapshotValue._dataAppQueryLoading.snapshotSha256,
            onChange: queries => {
              if (active) setSnapshot(current => ({ ...current, queries }));
            },
          });
          setQueryDataStore(store);
        }
        setPresentationRecord(record);
        setSnapshot(snapshotValue);
      })
      .catch((failure) => {
        controller.abort();
        if (active) setError(failure);
      });
    return () => {
      active = false;
      controller.abort();
      store?.dispose();
    };
  }, [hosted, attempt]);

  if (!snapshot) return error
    ? <DataAppLoadError error={error} onRetry={retry} />
    : <DataAppLoading />;
  return <ResolvedDataApp
    snapshot={snapshot}
    createContent={createContent}
    DashboardContent={DashboardContent}
    ReportContent={ReportContent}
    hosted={hosted}
    staticDemo={staticDemo}
    onSnapshotChange={setSnapshot}
    presentationRecord={presentationRecord}
    queryDataStore={queryDataStore}
  />;
}

function ResolvedDataApp({ snapshot, createContent, DashboardContent, ReportContent,
  hosted, staticDemo, onSnapshotChange, presentationRecord, queryDataStore }) {
  // Eager apps retain complete module-scope imports. Explicit on-demand apps
  // declare dependencies through QueryDataBoundary before reading reviewed rows.
  // Keep component identities stable through later data updates and edits.
  const [content] = useState(() => createContent
    ? createContent(snapshot) : { DashboardContent, ReportContent });
  const Content = snapshot.surface === "report" ? content.ReportContent : content.DashboardContent;

  return (
    <DataAppShell
      snapshot={snapshot}
      hosted={hosted}
      onSnapshotChange={onSnapshotChange}
      canEdit={!staticDemo && (!hosted || presentationRecord.canEdit === true)}
      persistLocally={!staticDemo}
      initialPresentation={presentationRecord.presentation}
      initialRevision={presentationRecord.revision}
      queryDataStore={queryDataStore}
    >
      <Content />
    </DataAppShell>
  );
}
