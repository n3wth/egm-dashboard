import React from "react";
import { SvgIcon } from "./SvgIcon.jsx";
import materialSymbols from "../content/dashboard/material-symbols.json";

const dashboardIconAssets = import.meta.glob("./icons/dashboard-icon-*.svg", {
  eager: true,
  import: "default",
  query: "?url",
});
const dashboardIcons = Object.fromEntries(
  Object.entries(dashboardIconAssets).map(([path, asset]) => [
    path.slice("./icons/dashboard-icon-".length, -".svg".length),
    asset,
  ]),
);

/** Inline builds may decode bundled, data-only icon assets before mounting. */
export async function prepareDashboardIcons() {
  await Promise.all(Object.entries(dashboardIcons).map(async ([name, asset]) => {
    dashboardIcons[name] = await asset;
  }));
}

export const dashboardIconNames = Object.freeze([...new Set([...Object.keys(dashboardIcons), ...Object.keys(materialSymbols.icons)])]);

export function Icon({ name, size = 16, className = "" }) {
  const symbol = materialSymbols.icons[name];
  const icon = symbol ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(symbol)}` : dashboardIcons[name];
  if (!icon)
    throw new Error(`Unknown dashboard icon: ${String(name)}. Add a bundled dashboard-icon-${String(name)}.svg asset.`);
  return <SvgIcon name={name} src={icon} size={size} className={className} />;
}
