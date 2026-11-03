import React, { useEffect, useMemo, useState } from "react";
import { XAxis, YAxis, getNiceTickValues, useXAxisDomain, useXAxisTicks, useYAxisDomain, useYAxisTicks } from "recharts";
import { mergeNumericAxisTicks, numericAxisFormatter } from "./chart-theme.js";
import { roundedNumericTicks, usesRoundedNumericScale, zeroAnchoredDomain } from './numeric-axis-scale.mjs';

function useRoundedScale(props, domain, tickCount, allowDecimals, percent) {
  const automatic = usesRoundedNumericScale(props, percent);
  const domainSignature = JSON.stringify(domain ?? null);
  const ticks = useMemo(() => roundedNumericTicks(JSON.parse(domainSignature), tickCount, allowDecimals),
    [domainSignature, tickCount, allowDecimals]);
  const resolveDomain = useMemo(() => bounds => {
    const ticks = roundedNumericTicks(zeroAnchoredDomain(bounds), tickCount, allowDecimals);
    return ticks.length ? [ticks[0], ticks.at(-1)] : zeroAnchoredDomain(bounds);
  }, [tickCount, allowDecimals]);
  return automatic ? { domain: resolveDomain, ticks, niceTicks: 'none' } : {};
}

function useNumericAxisFormatter(axis, axisId, domain, ticks, percent, percentDigits, tickCount, allowDecimals, currency) {
  const numericDomain =
    Array.isArray(domain) && domain.length === 2 && domain.every(Number.isFinite)
      ? [...domain].sort((left, right) => left - right)
      : null;
  const domainSignature = JSON.stringify(numericDomain);
  const key = JSON.stringify([axis, axisId, domainSignature, percent, percentDigits, tickCount, allowDecimals, currency]);
  const seed = useMemo(() => {
    const bounds = JSON.parse(domainSignature);
    return bounds ? getNiceTickValues(bounds, tickCount, allowDecimals).filter(Number.isFinite) : [];
  }, [domainSignature, tickCount, allowDecimals]);
  const bounds = numericDomain ? [...numericDomain, ...seed] : null;
  const minimum = bounds ? Math.min(...bounds) : -Infinity;
  const maximum = bounds ? Math.max(...bounds) : Infinity;
  const tolerance = Math.max(1, Math.abs(minimum), Math.abs(maximum)) * Number.EPSILON * 16;
  const reported = (ticks ?? [])
    .map((entry) => entry.value)
    .filter((value) => Number.isFinite(value) && value >= minimum - tolerance && value <= maximum + tolerance);
  const candidates = mergeNumericAxisTicks(null, key, [...seed, ...reported]);
  const [history, setHistory] = useState(candidates);
  const current = mergeNumericAxisTicks(history, key, candidates.values);
  const signature = current.signature;
  const candidateSignature = candidates.signature;
  useEffect(() => {
    setHistory((previous) => mergeNumericAxisTicks(previous, key, JSON.parse(candidateSignature)));
  }, [key, candidateSignature]);
  return useMemo(() => {
    const format = numericAxisFormatter(JSON.parse(signature), { percent: percent === true, percentDigits, currency });
    return percent === "points" ? value => `${format(value)}%` : format;
  }, [signature, percent, percentDigits, currency]);
}

export function NumericXAxis({ percent = false, percentDigits, xAxisId = 0, tickCount = 5, allowDecimals = true, currency, ...props }) {
  const domain = useXAxisDomain(xAxisId);
  const rounded = useRoundedScale(props, domain, tickCount, allowDecimals, percent);
  const format = useNumericAxisFormatter(
    "x",
    xAxisId,
    domain,
    useXAxisTicks(xAxisId),
    percent,
    percentDigits,
    tickCount,
    allowDecimals,
    currency,
  );
  return (
    <XAxis {...props} {...rounded} xAxisId={xAxisId} tickCount={tickCount} allowDecimals={allowDecimals} tickFormatter={format} />
  );
}

export function NumericYAxis({ percent = false, percentDigits, yAxisId = 0, tickCount = 5, allowDecimals = true, currency, ...props }) {
  const domain = useYAxisDomain(yAxisId);
  const rounded = useRoundedScale(props, domain, tickCount, allowDecimals, percent);
  const format = useNumericAxisFormatter(
    "y",
    yAxisId,
    domain,
    useYAxisTicks(yAxisId),
    percent,
    percentDigits,
    tickCount,
    allowDecimals,
    currency,
  );
  return (
    <YAxis {...props} {...rounded} yAxisId={yAxisId} tickCount={tickCount} allowDecimals={allowDecimals} tickFormatter={format} />
  );
}
