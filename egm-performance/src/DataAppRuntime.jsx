import React, { useEffect, useState } from "react";

import { DataAppShell } from "./DataAppShell.jsx";
import { loadHostedSnapshot } from "./hosted-query-bootstrap.js";
import { createQueryDataStore } from "./query-data-store.js";
import { DataAppLoadingContent } from "./components/DataAppLoadingContent.jsx";
import { Button } from "./components/ui.jsx";

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

export function DataAppLoadError({ onRetry }) {
  return <main className="dashboard-shell-loading-error">
    <section className="dashboard-shell-error-card" aria-labelledby="dashboard-load-error-title">
      <div role="alert">
        <h1 id="dashboard-load-error-title">Couldn’t load the dashboard</h1>
        <p>Check your connection and try again. If your session expired or the dashboard was updated, reload the page.</p>
      </div>
      <div className="dashboard-shell-error-actions">
        <Button variant="primary" onClick={onRetry}>Try again</Button>
        <Button onClick={() => globalThis.location?.reload()}>Reload page</Button>
      </div>
    </section>
  </main>;
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
  const [attempt, setAttempt] = useState(0);
  const [queryDataStore, setQueryDataStore] = useState(null);
  const loaded = snapshot !== null;

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
    if (attempt > 0 && loaded) document.getElementById("data-app-main")?.focus();
  }, [attempt, loaded]);

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
      .catch(() => {
        controller.abort();
        if (active) setError(true);
      });
    return () => {
      active = false;
      controller.abort();
      store?.dispose();
    };
  }, [hosted, attempt]);

  if (!snapshot) return error
    ? <DataAppLoadError onRetry={retry} />
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
