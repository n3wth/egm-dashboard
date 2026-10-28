export function engagementSignals(row={}) {
  const fields=[['views','Views',['views','viewCount']],['likes','Likes',['likes','likeCount']],['reactions','Reactions',['reactions','reactionCount']],['comments','Comments',['comments','commentCount']],['reposts','Reposts',['reposts','repostCount']],['points','HN points',['hnPoints','points']]]
  const observedAt=row.engagementObservedAt??row.statsObservedAt??row.observedAt
  // A discovery timestamp does not establish when an engagement number was checked.
  if(typeof observedAt!=='string'||!Number.isFinite(Date.parse(observedAt)))return []
  return fields.flatMap(([kind,label,keys])=>{
    const value=keys.map(key=>row[key]).find(value=>Number.isSafeInteger(value)&&value>=0)
    return value===undefined?[]:[{kind,label,value,observedAt,source:row.engagementSource??row.statsSource??row.provider??null}]
  })
}
