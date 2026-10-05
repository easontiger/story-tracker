import fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import XXH from 'xxhashjs';
import { request, table, repository, revision } from './source.mjs';
const root = dirname(fileURLToPath(import.meta.url));
// 用户确认删除：这四条羁绊的所有语言正文为空，只有演出配置。
// 用户确认删除：活动记录 708（剧情组 60）的全部正文和脚本为空。
export const excludedEventIds = new Set([708]);
export const excludedFavorIds = new Set([190172,190173,190175,190176]);
export const keyOf = code => XXH.h32(code, 0).toNumber();
export const modeCode = (m, level) => m.ModeType + '_' + level + '_Title_' +
  (m.SubType === 'Series2' ? 'Series2_' : '') +
  [m.VolumeId, ...(level !== 'Volume' ? [m.ChapterId] : []), ...(level === 'Episode' ? [m.EpisodeId] : [])].join('_');
const pick = (row, keys) => Object.fromEntries(keys.map(k => [k,row[k]]));
export async function pack(raw, source, scriptTitles, cnCharacters) {
  const favors=raw.favors.filter(x=>!excludedFavorIds.has(x.Id));
  const needed = new Set();
  for (const m of raw.modes) for (const level of ['Volume','Chapter','Episode']) needed.add(keyOf(modeCode(m,level)));
  for (const e of raw.seasons) needed.add(keyOf(e.Name));
  for (const f of favors) needed.add(f.LocalizeScenarioId);
  for (const c of raw.contents) needed.add(c.LocalizeId);
  const characters = raw.characters.filter(x => favors.some(f => f.CharacterId === x.Id))
    .map(x => pick(x,['Id','LocalizeEtcId']));
  const charKeys = new Set(characters.map(x=>x.LocalizeEtcId));
  return {
    source,
    modes: raw.modes.map(x=>pick(x,['ModeId','ModeType','SubType','VolumeId','ChapterId','EpisodeId','Hide','Open','FrontScenarioGroupId','BackScenarioGroupId'])),
    events: raw.events.filter(x=>!excludedEventIds.has(x.Id)).map(x=>pick(x,['Id','EventContentId','Order','ReplayDisplayGroup','IsMeetup','ScenarioGroupId'])),
    seasons: raw.seasons.map(x=>pick(x,['EventContentId','OriginalEventContentId','IsReturn','Name','EventContentType'])),
    favors: favors.map(x=>pick(x,['Id','CharacterId','ScheduleGroupId','OrderInGroup','LocalizeScenarioId','ScenarioSriptGroupId'])),
    characters,
    localize: raw.localize.filter(x=>needed.has(x.Key)).map(x=>pick(x,['Key','Tw','Jp'])),
    characterNames: raw.etc.filter(x=>charKeys.has(x.Key)).map(x=>({Key:x.Key,Tw:x.NameTw,Jp:x.NameJp})),
    stages:raw.stages.map(x=>pick(x,['Id','EventContentId','StageNumber','EnterScenarioGroupId','ClearScenarioGroupId'])),
    eventChanges:raw.eventChanges.map(x=>pick(x,['EventContentId','ChangeType','ChangeCount','ScenarioGroupId'])),
    contents:raw.contents.map(x=>pick(x,['Id','LocalizeId','DisplayOrder','ScenarioContentType','ScenarioGroupId'])),
    excludedGroups:raw.excludedGroups,
    scriptTitles, cnCharacters,
  };
}
export async function refresh() {
  const meta = await revision();
  const commit = meta.sha;
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('无法取得 global 版本');
  const raw = {};
  const names = {
    stages:'EventContentStage', eventChanges:'EventContentChangeScenario', contents:'ContentsScenario',
    modes:'ScenarioMode', events:'EventContentScenario', seasons:'EventContentSeason',
    favors:'AcademyFavorSchedule', characters:'Character', localize:'Localize', etc:'LocalizeEtc',
  };
  await Promise.all(Object.entries(names).map(async ([key,name])=>{
    raw[key]=await table(commit,'DB/'+name+'ExcelTable.json');
    console.error('读取 DB/'+name+'ExcelTable.json');
  }));
  raw.excludedGroups=await excludedScenarioGroups(commit);
  const scriptTitles = [];
  for(let part=1;part<=3;part++){
    const path='DB/ScenarioScriptExcelTable'+part+'.json';
    const rows=await request('https://raw.githubusercontent.com/'+repository+'/'+commit+'/'+path);
    if(!Array.isArray(rows.DataList))throw new Error(path+': 缺少 DataList');
    for(const x of rows.DataList)if(/^#title(?:;|\s|$)/i.test(x.ScriptKr||'')){
      scriptTitles.push({GroupId:x.GroupId,Tw:x.TextTw,Jp:x.TextJp,episodeLabel:x.ScriptKr.split(';').length>=3,path});
    }
    console.error(path+'：仅保留标题');
  }
  const old = JSON.parse(await fs.readFile(join(root,'data-snapshot.json'),'utf8'));
  const snapshot=await pack(raw,{repository,branch:'global',commit,committedAt:meta.commit.committer.date,
    version:meta.commit.message.split('\n')[0],checkedAt:new Date().toISOString()},scriptTitles,old.cnCharacters);
  // Parsing/validation completes before replacing the bundled title-only source.
  const {build}=await import('./parser.mjs');
  const cn=JSON.parse(await fs.readFile(join(root,'zh-cn.json'),'utf8'));
  build(snapshot,cn);
  const temporary=join(root,'data-snapshot.json.pending');
  await fs.writeFile(temporary,JSON.stringify(snapshot,null,2)+'\n');
  await fs.rename(temporary,join(root,'data-snapshot.json'));
  return snapshot;
}

const excludedTables = {
  MiniGameDreamCollectionScenario:['ScenarioGroupId'],
  MiniGameDreamEnding:['ScenarioGroupId'],
  MiniGameDreamTimeline:['EnterScenarioGroupId'],
  MinigameCCGLevelStage:['IntroScenarioGroupId','OutroScenarioGroupId'],
  MinigameRoadPuzzleRoadRound:['EnterScenarioGroupId','EndScenarioGroupId'],
};
export async function excludedScenarioGroups(commit){
  const result=await Promise.all(Object.entries(excludedTables).map(async([name,fields])=>{
    const path='DB/'+name+'ExcelTable.json';
    const rows=await table(commit,path);
    return rows.flatMap(row=>fields.flatMap(field=>{
      const values=Array.isArray(row[field])?row[field]:[row[field]];
      if(!values.every(x=>Number.isSafeInteger(x)&&x>=0))throw new Error(path+': 无效 '+field);
      return values.filter(x=>x>0).map(groupId=>({groupId,path,field}));
    }));
  }));
  return result.flat();
}
