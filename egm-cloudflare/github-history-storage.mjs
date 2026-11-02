const dailyIds=['traffic','activity']
const windowIds=['reach','referrers','paths','downloads','website','website_contribution']
const quoted=values=>values.map(value=>`'${value}'`).join(',')
const observed="coalesce(json_extract(q.value,'$.source.executedAt'),json_extract(i.body,'$.queries.traffic.source.executedAt'),json_extract(i.body,'$.generatedAt'))"
const dailyRows=`
  SELECT d.key AS query_id,json_extract(r.value,'$.date') AS date,
    coalesce(json_extract(r.value,'$.observedAt'),json_extract(i.body,'$.generatedAt')) AS observed_at,r.value AS body
  FROM inputs i,json_each(i.body,'$.githubHistory.daily') d,json_each(d.value) r
  WHERE d.key IN (${quoted(dailyIds)})
  UNION ALL
  SELECT q.key,json_extract(r.value,'$.date'),${observed},json_set(r.value,'$.observedAt',${observed})
  FROM inputs i,json_each(i.body,'$.queries') q,json_each(q.value,'$.rows') r
  WHERE q.key IN (${quoted(dailyIds)})`
const windowRows=`
  SELECT q.key AS query_id,substr(json_extract(w.value,'$.observedAt'),1,10) AS collection_date,
    json_extract(w.value,'$.observedAt') AS observed_at,q.value AS body
  FROM inputs i,json_each(i.body,'$.githubHistory.windows') w,json_each(w.value,'$.queries') q
  WHERE q.key IN (${quoted(windowIds)})
  UNION ALL
  SELECT q.key,substr(${observed},1,10),${observed},q.value
  FROM inputs i,json_each(i.body,'$.queries') q
  WHERE q.key IN (${quoted(windowIds)})`

function upsert(table,key,rows,input,guard) {
  return `WITH inputs(body) AS (${input}),records AS (${rows})
    INSERT INTO ${table}(query_id,${key},observed_at,body)
    SELECT query_id,${key},observed_at,body FROM records WHERE ${guard}
    ON CONFLICT(query_id,${key}) DO UPDATE SET observed_at=excluded.observed_at,body=excluded.body
    WHERE julianday(excluded.observed_at)>=julianday(${table}.observed_at)`
}
const snapshotInput='SELECT body FROM snapshots WHERE id=1'
export const historyMigrationStatements=[
  upsert('github_daily_history','date',dailyRows,snapshotInput,'1'),
  upsert('github_window_history','collection_date',windowRows,snapshotInput,'1')
]
export const historyVerificationSql=`WITH inputs(body) AS (${snapshotInput}),daily AS (${dailyRows}),windows AS (${windowRows})
  SELECT
    (SELECT count(*) FROM daily s LEFT JOIN github_daily_history d ON d.query_id=s.query_id AND d.date=s.date
      WHERE d.query_id IS NULL OR julianday(d.observed_at)<julianday(s.observed_at)) AS missing_daily,
    (SELECT count(*) FROM windows s LEFT JOIN github_window_history d ON d.query_id=s.query_id AND d.collection_date=s.collection_date
      WHERE d.query_id IS NULL OR julianday(d.observed_at)<julianday(s.observed_at)) AS missing_windows`

function input(snapshot) {
  return JSON.stringify({generatedAt:snapshot.generatedAt,githubHistory:snapshot.githubHistory,
    queries:Object.fromEntries([...dailyIds,...windowIds].filter(id=>snapshot.queries?.[id]).map(id=>[id,snapshot.queries[id]]))})
}

// Append after the fenced snapshot upsert in the same D1.batch transaction.
export function archiveStatements(db,previous,snapshot,commitAt,leaseId) {
  const guard='EXISTS(SELECT 1 FROM refresh_control WHERE id=1 AND lease_id=? AND lease_until>?) AND EXISTS(SELECT 1 FROM snapshots WHERE id=1 AND generated_at=?)'
  const args=[input(previous),input(snapshot),leaseId,Date.parse(commitAt),commitAt]
  const inputs='SELECT ? UNION ALL SELECT ?'
  return [
    db.prepare(upsert('github_daily_history','date',dailyRows,inputs,guard)).bind(...args),
    db.prepare(upsert('github_window_history','collection_date',windowRows,inputs,guard)).bind(...args)
  ]
}
