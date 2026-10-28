import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Tooltip, TruncatedText, useTabOverflow } from "./ui.jsx";
import { Icon } from "./Icon.jsx";

const tabDragStartDistance = 4;

function PageIcon({id}) {
  const path={reach:'M3 10.5 12 3l9 7.5M5 9v12h5v-7h4v7h5V9',adoption:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75',development:'m8 5-6 7 6 7m8-14 6 7-6 7m-3-15-2 16'}[id];
  if(path)return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><path d={path}/>{id==='adoption'&&<circle cx="9" cy="7" r="4"/>}</svg>;
  return <Icon name={({acquisition:'arrowUpRight',website:'globe',research:'search',mentions:'chatBubble'})[id]??'textDocument'} size={18}/>;
}

function reorderDashboardTabToIndex(tabs, sourceId, targetIndex) {
  const sourceIndex = tabs.findIndex(({ id }) => id === sourceId);
  if (sourceIndex < 0) return tabs;
  const next = [...tabs];
  const [source] = next.splice(sourceIndex, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, source);
  return next.every(({ id }, index) => id === tabs[index]?.id) ? tabs : next;
}

export function DashboardTabs({
  tabs, activeTabId, editMode = false, onChange, onReorder, trailing,
}) {
  const [dragPreview, setDragPreview] = useState(null);
  const [animateSelection, setAnimateSelection] = useState(false);
  const [pressedTabId, setPressedTabId] = useState(null);
  const drag = useRef({ id: null, moved: false });
  const navRef = useRef(null);
  const scrollRef = useRef(null);
  const tabRefs = useRef(new Map());
  const labelRefs = useRef(new Map());
  const previousPositions = useRef(new Map());
  const tabsRef = useRef(tabs);
  const onReorderRef = useRef(onReorder);
  tabsRef.current = tabs;
  onReorderRef.current = onReorder;
  useTabOverflow(scrollRef, `${activeTabId}:${tabs.map(({ id, label }) => `${id}:${label}`).join("|")}`);

  function captureTabPositions() {
    previousPositions.current = new Map(Array.from(tabRefs.current, ([id, element]) =>
      [id, element.getBoundingClientRect().left]));
  }

  function reorderForDrag(cursorX) {
    const sourceId = drag.current.id;
    if (!sourceId) return;
    const currentTabs = tabsRef.current;
    const remainingTabs = currentTabs.filter(({ id }) => id !== sourceId);
    const firstTabAfterCursor = remainingTabs.findIndex(({ id }) => {
      const bounds = tabRefs.current.get(id)?.getBoundingClientRect();
      return bounds && cursorX < bounds.left + bounds.width / 2;
    });
    const targetIndex = firstTabAfterCursor < 0 ? remainingTabs.length : firstTabAfterCursor;
    const nextTabs = reorderDashboardTabToIndex(currentTabs, sourceId, targetIndex);
    if (nextTabs === currentTabs) return;
    captureTabPositions();
    tabsRef.current = nextTabs;
    onReorderRef.current?.(nextTabs);
  }

  useLayoutEffect(() => {
    if (!previousPositions.current.size || !navRef.current) return;
    const styles = getComputedStyle(navRef.current);
    const duration = Number.parseFloat(styles.getPropertyValue("--dashboard-tab-reorder-duration")) || 0;
    const easing = styles.getPropertyValue("--dashboard-tab-reorder-easing").trim() || "ease";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const [id, element] of tabRefs.current) {
      if (id === drag.current.id) continue;
      const previousLeft = previousPositions.current.get(id);
      if (previousLeft == null) continue;
      const distance = previousLeft - element.getBoundingClientRect().left;
      if (!distance || reduceMotion || !duration) continue;
      element.getAnimations?.().forEach((animation) => animation.cancel());
      element.animate([
        { transform: `translateX(${distance}px)` },
        { transform: "translateX(0)" },
      ], { duration, easing });
    }
    previousPositions.current.clear();
  }, [tabs]);

  useLayoutEffect(() => {
    for (const label of labelRefs.current.values()) {
      label.dataset.overflowing = String(label.scrollWidth > label.clientWidth + 1);
    }
  }, [tabs]);

  useEffect(() => {
    function move(event) {
      const current = drag.current;
      if (!current.id) return;
      if (!current.moved && Math.hypot(event.clientX - current.startX,
        event.clientY - current.startY) < tabDragStartDistance) return;
      current.moved = true;
      const horizontalMovement = event.clientX - current.lastX;
      if (Math.abs(horizontalMovement) >= 0.5) current.direction = Math.sign(horizontalMovement);
      current.lastX = event.clientX;
      setDragPreview({
        id: current.id,
        label: current.label,
        left: event.clientX - current.offsetX,
        top: event.clientY - current.offsetY,
        width: current.width,
        height: current.height,
        direction: current.direction,
      });
      reorderForDrag(event.clientX);
    }

    function finish(event) {
      if (!drag.current.id) return;
      if (drag.current.moved) reorderForDrag(event.clientX);
      drag.current.id = null;
      setPressedTabId(null);
      setDragPreview(null);
    }

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", finish);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finish);
    };
  }, []);

  return <div className="dashboard-tabs-row">
    <div ref={scrollRef} className="dashboard-chrome-inner dashboard-tabs-inner">
      <nav ref={navRef} className={`dashboard-tabs egm-icon-tabs${animateSelection ? " has-user-selection" : ""}${pressedTabId ? " is-pressed" : ""}${dragPreview ? " is-dragging" : ""}`}
        role="tablist" aria-label="Dashboard pages">
        {tabs.map((tab) => <span className="dashboard-tab-item history-tooltip-trigger" role="presentation" key={tab.id}>
          <button type="button" role="tab"
          ref={(element) => {
            if (element) tabRefs.current.set(tab.id, element);
            else tabRefs.current.delete(tab.id);
          }}
          className={`dashboard-tab${dragPreview?.id === tab.id ? " is-dragging" : ""}`}
          data-dashboard-tab-id={tab.id}
          aria-label={tab.label}
          aria-selected={activeTabId === tab.id} tabIndex={activeTabId === tab.id ? 0 : -1}
          onClick={(event) => {
            if (drag.current.moved) {
              drag.current.moved = false;
              event.preventDefault();
              return;
            }
            setAnimateSelection(true);
            onChange?.(tab.id);
          }}
          onMouseDown={editMode ? (event) => {
            if (event.button !== 0) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const nextDrag = {
              id: tab.id,
              label: tab.label,
              startX: event.clientX,
              startY: event.clientY,
              lastX: event.clientX,
              direction: 0,
              offsetX: event.clientX - bounds.left,
              offsetY: event.clientY - bounds.top,
              width: bounds.width,
              height: bounds.height,
              moved: false,
            };
            drag.current = nextDrag;
            setPressedTabId(tab.id);
          } : undefined}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const currentIndex = tabs.findIndex(({ id }) => id === tab.id);
            const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
              : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            const nextTab = tabs[nextIndex];
            setAnimateSelection(true);
            onChange?.(nextTab.id);
            tabRefs.current.get(nextTab.id)?.focus();
          }}>
          <PageIcon id={tab.id}/>
          <span className="egm-tab-label-wrap"><TruncatedText className="dashboard-tab-label" focusOnParent
            anchorRef={(element) => {
              if (element) labelRefs.current.set(tab.id, element);
              else labelRefs.current.delete(tab.id);
            }}>{tab.label}</TruncatedText></span>
          </button>
          {activeTabId!==tab.id&&<Tooltip className="topbar-mode-tooltip">{tab.label}</Tooltip>}
        </span>)}
      </nav>
      {trailing}
    </div>
    {dragPreview && typeof document !== "undefined" && createPortal(
      <div className="dashboard-tab-drag-preview" aria-hidden="true"
        data-drag-direction={dragPreview.direction} style={{
        left: dragPreview.left,
        top: dragPreview.top,
        width: dragPreview.width,
        height: dragPreview.height,
      }}>{dragPreview.label}</div>, document.body,
    )}
  </div>;
}
