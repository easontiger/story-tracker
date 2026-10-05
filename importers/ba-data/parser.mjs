import * as OpenCC from 'opencc-js';
import { keyOf, modeCode, excludedFavorIds, excludedEventIds } from './refresh.mjs';
const simplify = OpenCC.Converter({from:'t',to:'cn'});
const lines = [
  {id:'main',title:'主线',order:0}, {id:'events',title:'活动',order:1},
  {id:'club',title:'社团',order:2}, {id:'favor',title:'羁绊',order:3},
  {id:'mini',title:'迷你故事',order:4}, {id:'special',title:'特殊作战',order:5}, {id:'contents',title:'其他剧情',order:6},
];
const clean = s => (s||'').replace(/\[ruby=[^\]]*\]([\s\S]*?)\[\/ruby\]/g,'$1')
  .replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
const ensure = (condition,message) => {if(!condition)throw new Error(message);};
const ints = a => Array.isArray(a)&&a.every(x=>Number.isSafeInteger(x)&&x>=0);
function unique(rows,field,label){
  const map=new Map();
  for(const row of rows){
    ensure(Number.isSafeInteger(row[field]),label+': 无效 '+field);
    ensure(!map.has(row[field]),label+': 重复 '+field+' '+row[field]);
    map.set(row[field],row);
  }
  return map;
}
export function build(data, cn={names:[],episodes:[]}) {
  ensure(/^[a-f0-9]{40}$/.test(data.source?.commit||''),'缺少来源版本');
  for(const k of ['modes','events','seasons','favors','characters','localize','characterNames','scriptTitles','stages','eventChanges','contents','excludedGroups'])
    ensure(Array.isArray(data[k]),'缺少数据表 '+k);
  const loc=unique(data.localize,'Key','Localize');
  const charLoc=unique(data.characterNames,'Key','LocalizeEtc');
  const chars=unique(data.characters,'Id','Character');
  unique(data.modes,'ModeId','ScenarioMode');
  unique(data.events,'Id','EventContentScenario');
  unique(data.favors,'Id','AcademyFavorSchedule');
  unique(data.stages,'Id','EventContentStage');
  unique(data.contents,'Id','ContentsScenario');
  const overrides=new Map();
  for(const x of [...cn.names,...cn.episodes]){
    ensure(typeof x.code==='string'&&clean(x.title)&&/^https:\/\//.test(x.source),'无效简中对照');
    ensure(!overrides.has(x.code),'重复简中对照 '+x.code);
    ensure(loc.has(keyOf(x.code))||data.seasons.some(e=>e.Name===x.code),'简中对照无法关联源表 '+x.code);
    overrides.set(x.code,x);
  }
  const eventOverrides=new Map();
  for(const x of cn.events||[]){
    const source=data.events.find(e=>e.Id===x.recordId);
    ensure(source&&source.EventContentId===x.eventId&&source.Order===x.order&&ints(x.groups)&&
      source.ScenarioGroupId.join(',')===x.groups.join(',')&&clean(x.title)&&/^https:\/\//.test(x.source),
      '活动标题对照无法可靠关联源记录 '+x.recordId);
    const key=x.eventId+':'+x.groups.join(',');
    ensure(!eventOverrides.has(key),'重复活动标题对照 '+x.recordId);
    eventOverrides.set(key,{title:x.title,rawTitle:'',titleLanguage:'zh-CN（用户核对）',
      sourceFile:'zh-cn.json#events/recordId='+x.recordId,titleSourceUrl:x.source,episode:x.order});
  }
  const dateEntries=cn.eventDates?.entries||[];
  ensure(!cn.eventDates||cn.eventDates.server==='CN','活动日期必须使用国服来源');
  ensure(Array.isArray(dateEntries),'活动日期列表无效');
  const eventDates=new Map();
  for(const entry of dateEntries){
    ensure(Number.isSafeInteger(entry.eventId)&&!eventDates.has(entry.eventId)&&
      data.seasons.some(e=>e.EventContentId===entry.eventId&&e.OriginalEventContentId===entry.eventId)&&
      typeof entry.releasedAt==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(entry.releasedAt)&&
      Number.isFinite(Date.parse(entry.releasedAt))&&new Date(entry.releasedAt).toISOString().slice(0,10)===entry.releasedAt&&
      /^https:\/\/(?:www\.)?bluearchive-cn\.com\/news\/\d+$/.test(entry.source),
      '无效或重复国服活动日期 '+entry.eventId);
    eventDates.set(entry.eventId,entry);
  }
  const mainDateEntries=cn.mainDates?.entries||[];
  ensure(!cn.mainDates||cn.mainDates.server==='CN','主线日期必须使用国服来源');
  ensure(Array.isArray(mainDateEntries),'主线日期列表无效');
  const mainDates=new Map();
  for(const entry of mainDateEntries){
    ensure(['Main','Prologue'].includes(entry.modeType)&&['Series1','Series2'].includes(entry.series)&&
      [entry.volumeId,entry.chapterId,entry.firstEpisode,entry.lastEpisode].every(Number.isSafeInteger)&&
      entry.volumeId>=0&&entry.chapterId>=0&&entry.firstEpisode>=1&&entry.lastEpisode>=entry.firstEpisode&&
      typeof entry.releasedAt==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(entry.releasedAt)&&
      Number.isFinite(Date.parse(entry.releasedAt))&&new Date(entry.releasedAt).toISOString().slice(0,10)===entry.releasedAt&&
      /^https:\/\/(?:www\.)?bluearchive-cn\.com\/news\/\d+$/.test(entry.source),
      '无效国服主线日期或话数范围');
    const matches=data.modes.filter(m=>m.ModeType===entry.modeType&&m.SubType===entry.series&&m.VolumeId===entry.volumeId&&
      m.ChapterId===entry.chapterId&&m.EpisodeId>=entry.firstEpisode&&m.EpisodeId<=entry.lastEpisode);
    ensure(new Set(matches.map(m=>m.EpisodeId)).size===entry.lastEpisode-entry.firstEpisode+1,'主线日期无法关联完整话数范围');
    for(const mode of matches){
      ensure(!mainDates.has(mode.ModeId),'主线日期范围重叠 '+mode.ModeId);
      mainDates.set(mode.ModeId,entry);
    }
  }
  const report={
    source:data.source,
    fields:{
      mode:{path:'DB/ScenarioModeExcelTable.json',id:'ModeId',kind:'ModeType',series:'SubType',hierarchy:['VolumeId','ChapterId','EpisodeId'],groups:['FrontScenarioGroupId','BackScenarioGroupId']},
      event:{path:'DB/EventContentScenarioExcelTable.json',id:'Id',parent:'EventContentId',order:'Order',groups:'ScenarioGroupId'},
      eventTitleOverrides:{path:'zh-cn.json',keys:['eventId','recordId','order','groups'],source:'用户提供的 Bilibili 分集名称'},
      eventStage:{path:'DB/EventContentStageExcelTable.json',groups:['EnterScenarioGroupId','ClearScenarioGroupId'],parent:'EventContentId'},
      eventChange:{path:'DB/EventContentChangeScenarioExcelTable.json',pair:['EventContentId','ChangeCount'],kind:'ChangeType'},
      contents:{path:'DB/ContentsScenarioExcelTable.json',id:'Id',titleId:'LocalizeId',order:'DisplayOrder',groups:'ScenarioGroupId'},
      eventMapping:{path:'DB/EventContentSeasonExcelTable.json',filter:'Stage / SeasonalEvent / SpecialMiniEvent / MinigameRhythmEvent',original:'OriginalEventContentId'},
      favor:{path:'DB/AcademyFavorScheduleExcelTable.json',id:'Id',character:'CharacterId',titleId:'LocalizeScenarioId',order:'OrderInGroup',groups:'ScenarioSriptGroupId'},
      uiTitle:{path:'DB/LocalizeExcelTable.json',key:'Key = xxHash32(code, 0)',chinese:'Tw',japanese:'Jp'},
      scriptTitle:{paths:[1,2,3].map(i=>'DB/ScenarioScriptExcelTable'+i+'.json'),filter:'ScriptKr starts with #title',key:'GroupId',chinese:'TextTw',japanese:'TextJp'},
    },
    scope:{excluded:['独立小游戏剧情','网页活动'],note:'普通活动主线剧情保留；按小游戏源表的明确剧情组引用排除。'},
    excludedRecords:[], eventSegments:[], unreferencedTitleDetails:[],
    counts:{}, missingTitles:[], missingDirectories:[], duplicateScriptGroups:[],
    mergedNodes:[], excludedHidden:[], unreferencedTitleGroups:[], repeatedTitles:[],
    coverageNotes:[
      '标题目录来自 global 分支，不代表国服当前进度；活动和主线日期使用国服官网首次开放日期，主线按各批次话数分别记录，其他类型暂未提取。',
      '主线、社团、迷你故事、特殊作战使用 ScenarioMode 的 VolumeId / ChapterId / EpisodeId。',
      '活动使用 EventContentScenario.Order；羁绊使用 AcademyFavorSchedule.OrderInGroup。',
      '角色名称优先使用简中对照；换装版缺少独立对照时，按日文原名精确关联普通版，沿用其简中姓名并保留来源换装描述。其余未核实标题仅转换繁中字形。',
      '其他剧情使用 ContentsScenario 的 LocalizeId、DisplayOrder 和 ScenarioGroupId。',
      '独立小游戏剧情、网页活动按用户要求排除，不计为待补内容；不提取 MomoTalk 聊天正文。',
    ],
  };
  const excludedGroups=new Set(data.excludedGroups.map(x=>{
    ensure(Number.isSafeInteger(x.groupId)&&x.groupId>0&&/^DB\/(MiniGame|Minigame).*ExcelTable\.json$/.test(x.path),'无效小游戏排除来源');
    return x.groupId;
  }));
  const scripts=new Map(), usedGroups=new Set(excludedGroups);
  for(const x of data.scriptTitles){
    ensure(Number.isSafeInteger(x.GroupId)&&/^DB\/ScenarioScriptExcelTable[123]\.json$/.test(x.path),'无效标题来源');
    const trim = v => x.episodeLabel && typeof v==='string' && v.includes(';') ? v.slice(v.indexOf(';')+1) : v;
    const t={...x,Tw:trim(x.Tw),Jp:trim(x.Jp),episode:x.episodeLabel?clean((x.Tw||x.Jp||'').split(';')[0]):''};
    if(!scripts.has(x.GroupId)) scripts.set(x.GroupId,[]);
    scripts.get(x.GroupId).push(t);
  }
  for(const [id,items]of scripts)if(items.length>1) report.duplicateScriptGroups.push({groupId:id,titles:items.map(x=>({Tw:x.Tw,Jp:x.Jp,path:x.path}))});
  const repoUrl='https://github.com/'+data.source.repository+'/blob/'+data.source.commit+'/';
  function title(row,code,sourceFile){
    const override=code&&overrides.get(code);
    if(!row&&!override)return null;
    const original=clean(row?.Tw)||clean(row?.Jp);
    if(!original&&!override)return null;
    return {
      title:override?override.title:clean(row.Tw)?simplify(clean(row.Tw)):clean(row.Jp),
      rawTitle:original,
      titleLanguage:override?(override.source.includes('bluearchive-cn.com')?'zh-CN（官网）':'zh-CN（来源对照）'):clean(row.Tw)?'zh-TW→zh-CN（待简中核对）':'ja（待翻译）',
      sourceFile,titleSourceUrl:override?.source||repoUrl+sourceFile.split('#')[0],
    };
  }
  function local(code){const key=keyOf(code);return title(loc.get(key),code,'DB/LocalizeExcelTable.json#Key='+key+' ('+code+')');}
  function scriptTitle(groups){
    const found=[];
    for(const id of groups){
      usedGroups.add(id);
      const candidates=(scripts.get(id)||[]).filter(x=>clean(x.Tw)||clean(x.Jp));
      if(candidates.length>1&&new Set(candidates.map(x=>clean(x.Tw)+'|'+clean(x.Jp))).size>1) continue;
      if(candidates.length){
        const x=candidates[0],t=title(x,null,x.path+'#GroupId='+id);
        if(!found.some(y=>y.title===t.title)) found.push({...t,episode:x.episode});
      }
    }
    if(!found.length)return null;
    return {...found[0],title:found.map(x=>x.title).join(' / '),rawTitle:found.map(x=>x.rawTitle).join(' / '),sourceFile:found.map(x=>x.sourceFile).join('; '),
      titleLanguage:found.map(x=>x.titleLanguage).filter((x,i,a)=>a.indexOf(x)===i).join('; ')};
  }
  const rows=[], containers=new Map(), nodes=[];
  function directory(key,line,parentKey,name,order){
    ensure(Number.isSafeInteger(order)&&order>=0,'无效目录顺序 '+key);
    if(containers.has(key)){
      ensure(containers.get(key).title===name.title&&containers.get(key).parentKey===parentKey,'目录冲突 '+key);
      return;
    }
    const node={sourceKey:key,storyLineId:line,parentKey,title:name.title,order,releasedAt:null,sourceUrl:name.titleSourceUrl||null};
    containers.set(key,node); nodes.push(node);
  }
  function dirName(code,fallback){
    const t=local(code);
    if(t)return t;
    if(!report.missingDirectories.some(x=>x.code===code&&x.label===fallback))report.missingDirectories.push({code,label:fallback});
    return {title:fallback,rawTitle:'',titleLanguage:'未知',sourceFile:'DB/ScenarioModeExcelTable.json'};
  }
  function add(r,parentKey){
    ensure(!rows.some(x=>x.sourceKey===r.sourceKey),'重复节点 '+r.sourceKey);
    ensure(clean(r.title)&&Number.isSafeInteger(r.order)&&r.order>=0,'无效剧情节点 '+r.sourceKey);
    rows.push({...r,parentKey});
    nodes.push({sourceKey:r.sourceKey,storyLineId:r.line,parentKey,title:r.title,order:r.order,releasedAt:null,sourceUrl:r.titleSourceUrl});
  }
  const modeSeen=new Map();
  for(const m of data.modes){
    ensure(ints(m.FrontScenarioGroupId)&&ints(m.BackScenarioGroupId),'无效剧情组 '+m.ModeId);
    for(const k of ['VolumeId','ChapterId','EpisodeId'])ensure(Number.isSafeInteger(m[k])&&m[k]>=0,'无效顺序 '+m.ModeId);
    const groups=[...m.FrontScenarioGroupId,...m.BackScenarioGroupId];
    groups.forEach(x=>usedGroups.add(x));
    if(m.Hide||!m.Open){report.excludedHidden.push({modeId:m.ModeId,groups});continue;}
    const line={Main:'main',Prologue:'main',Sub:'club',Mini:'mini',SpecialOperation:'special'}[m.ModeType];
    ensure(line,'未知剧情类型 '+m.ModeType);
    const signature=line+':'+groups.join(',');
    if(groups.length&&modeSeen.has(signature)){
      const existing=modeSeen.get(signature);
      existing.aliasIds.push(m.ModeId);
      report.mergedNodes.push({type:'mode',id:m.ModeId,into:existing.nodeId,reason:'相同有序剧情组'});
      continue;
    }
    const t=local(modeCode(m,'Episode'))||scriptTitle(groups);
    if(!t){report.missingTitles.push({type:line,id:m.ModeId,groups,reason:'没有可用本地化标题或 #title'});continue;}
    const volumeKey='ba:'+m.ModeType+':'+m.SubType+':volume:'+m.VolumeId;
    const chapterKey=volumeKey+':chapter:'+m.ChapterId;
    const vn=dirName(modeCode(m,'Volume'),'卷 '+m.VolumeId);
    if(m.ModeType==='Main')vn.title=vn.title.replace(/^(\d+)\.\s*/, 'Vol.$1 ');
    const cn=dirName(modeCode(m,'Chapter'),'第'+m.ChapterId+'章');
    const seriesOrder=m.SubType==='Series2'?1000:0;
    directory(volumeKey,line,null,vn,seriesOrder+(m.ModeType==='Prologue'?0:m.VolumeId+1));
    const useChapter=line==='main'||line==='special';
    if(useChapter)directory(chapterKey,line,volumeKey,{...cn,title:'第'+m.ChapterId+'章 '+cn.title},m.ChapterId);
    const r={
      line,type:lines.find(x=>x.id===line).title,modeType:m.ModeType,series:m.SubType,volumeId:m.VolumeId,volumeName:vn.title,
      chapterId:m.ChapterId,chapterName:cn.title,nodeId:m.ModeId,episode:m.EpisodeId,order:m.EpisodeId,
      sourceKey:'ba:mode:'+m.ModeId,scriptGroupIds:groups,aliasIds:[],...t,
      sourceFile:'DB/ScenarioModeExcelTable.json#ModeId='+m.ModeId+'; '+t.sourceFile,
    };
    add(r,useChapter?chapterKey:volumeKey);
    if(groups.length)modeSeen.set(signature,rows.at(-1));
  }
  const seasons=new Map();
  for(const e of data.seasons.filter(e=>['Stage','SeasonalEvent','SpecialMiniEvent','MinigameRhythmEvent'].includes(e.EventContentType))){
    const old=seasons.get(e.EventContentId);
    if(old)ensure(old.OriginalEventContentId===e.OriginalEventContentId&&old.Name===e.Name,'活动映射冲突 '+e.EventContentId);
    else seasons.set(e.EventContentId,e);
  }
  const eventMerges=new Map();
  for(const x of cn.eventMerges||[]){
    ensure(Number.isSafeInteger(x.eventId)&&ints(x.recordIds)&&x.recordIds.length>1&&
      new Set(x.recordIds).size===x.recordIds.length&&ints(x.groups)&&clean(x.title)&&/^https:\/\//.test(x.source),'无效连续活动剧情合并');
    const sources=x.recordIds.map(id=>data.events.find(e=>e.Id===id));
    ensure(sources.every(e=>e&&e.EventContentId===x.eventId)&&
      sources.every((e,i)=>!i||e.Order>sources[i-1].Order)&&
      sources.flatMap(e=>e.ScenarioGroupId).join(',')===x.groups.join(','),'连续活动剧情合并无法可靠关联 '+x.eventId);
    const spec={anchor:sources[0].Id,ids:[...x.recordIds],groups:[...x.groups],
      title:{title:x.title,rawTitle:'',titleLanguage:'zh-CN（用户核对）',sourceFile:'zh-cn.json#eventMerges/eventId='+x.eventId,titleSourceUrl:x.source,episode:''}};
    for(const id of x.recordIds){ensure(!eventMerges.has(id),'重复连续活动剧情合并 '+id);eventMerges.set(id,spec);}
  }
  const eventSeen=new Map();
  for(const source of data.events){
    const merge=eventMerges.get(source.Id);
    if(merge&&source.Id!==merge.anchor)continue;
    const e=merge?{...source,ScenarioGroupId:merge.groups}:source;
    if(excludedEventIds.has(e.Id))continue;
    ensure(ints(e.ScenarioGroupId)&&Number.isSafeInteger(e.Order)&&e.Order>=0,'无效活动剧情 '+e.Id);
    e.ScenarioGroupId.forEach(x=>usedGroups.add(x));
    if(e.ScenarioGroupId.length&&e.ScenarioGroupId.every(g=>excludedGroups.has(g))){
      report.excludedRecords.push({type:'events',id:e.Id,eventId:e.EventContentId,groups:e.ScenarioGroupId,reason:'独立小游戏剧情，按用户要求排除',sources:data.excludedGroups.filter(x=>e.ScenarioGroupId.includes(x.groupId))});
      continue;
    }
    const season=seasons.get(e.EventContentId);
    ensure(season,'活动缺少父目录 '+e.EventContentId);
    const original=season.OriginalEventContentId;
    const originalSeason=seasons.get(original);
    ensure(originalSeason,'活动缺少首次版本映射 '+original);
    const signature=original+':'+e.ScenarioGroupId.join(',');
    if(eventSeen.has(signature)){
      const existing=eventSeen.get(signature);
      existing.aliasIds.push(e.Id);
      report.mergedNodes.push({type:'event',id:e.Id,into:existing.nodeId,eventId:e.EventContentId,reason:'OriginalEventContentId 和有序剧情组一致'});
      continue;
    }
    const manual=merge?.title||eventOverrides.get(original+':'+e.ScenarioGroupId.join(','));
    const originalTitle=scriptTitle(e.ScenarioGroupId);
    const t=manual?{...manual,rawTitle:originalTitle?.rawTitle||'',sourceFile:originalTitle?originalTitle.sourceFile+'; '+manual.sourceFile:manual.sourceFile}:originalTitle;
    if(!t){report.missingTitles.push({type:'events',id:e.Id,eventId:e.EventContentId,groups:e.ScenarioGroupId,reason:'没有可用 #title（不推断是否纯战斗）'});continue;}
    const vn=dirName(originalSeason.Name,'活动 '+original);
    if(originalSeason.EventContentType==='SeasonalEvent')vn.title+='（'+original+'）';
    const root='ba:event:'+original;
    directory(root,'events',null,vn,original);
    const r={
      line:'events',type:'活动',volumeId:original,volumeName:vn.title,chapterId:null,chapterName:'',
      nodeId:e.Id,episode:t.episode||'',order:e.Order,
      sourceKey:root+':groups:'+source.ScenarioGroupId.join('-'),scriptGroupIds:[...e.ScenarioGroupId],aliasIds:merge?merge.ids.slice(1):[],eventId:e.EventContentId,...t,
      sourceFile:'DB/EventContentScenarioExcelTable.json#Id='+(merge?merge.ids.join(','):e.Id)+'; '+t.sourceFile,
    };
    add(r,root);eventSeen.set(signature,rows.at(-1));
    if(merge)for(const id of merge.ids.slice(1))report.mergedNodes.push({type:'event',id,into:e.Id,eventId:e.EventContentId,reason:'用户确认的连战连续剧情'});
  }
  // Explicit links only; keep each existing titled sourceKey to preserve progress.
  for(const missing of [...report.missingTitles].filter(x=>x.type==='events')){
    const e=data.events.find(x=>x.Id===missing.id);
    const candidateGroups=[],sources=[];
    for(const stage of data.stages.filter(x=>x.EventContentId===e.EventContentId)){
      ensure(ints(stage.EnterScenarioGroupId)&&ints(stage.ClearScenarioGroupId),'无效关卡剧情关联 '+stage.Id);
      const groups=[...stage.EnterScenarioGroupId,...stage.ClearScenarioGroupId];
      if(e.ScenarioGroupId.every(g=>groups.includes(g))){
        candidateGroups.push(...groups);sources.push('DB/EventContentStageExcelTable.json#Id='+stage.Id);
      }
    }
    for(const change of data.eventChanges.filter(x=>x.EventContentId===e.EventContentId&&e.ScenarioGroupId.includes(x.ScenarioGroupId))){
      const pairs=data.eventChanges.filter(x=>x.EventContentId===change.EventContentId&&x.ChangeCount===change.ChangeCount&&['MainSub','SubMain'].includes(x.ChangeType));
      if(pairs.some(x=>x.ChangeType==='MainSub')&&pairs.some(x=>x.ChangeType==='SubMain')){
        candidateGroups.push(...pairs.map(x=>x.ScenarioGroupId));
        sources.push('DB/EventContentChangeScenarioExcelTable.json#EventContentId='+change.EventContentId+',ChangeCount='+change.ChangeCount);
      }
    }
    const targets=rows.filter(x=>x.line==='events'&&x.volumeId===seasons.get(e.EventContentId).OriginalEventContentId&&x.scriptGroupIds.some(g=>candidateGroups.includes(g)));
    if(targets.length!==1)continue;
    const target=targets[0];
    for(const g of e.ScenarioGroupId)if(!target.scriptGroupIds.includes(g))target.scriptGroupIds.push(g);
    if(!target.aliasIds.includes(e.Id))target.aliasIds.push(e.Id);
    report.eventSegments.push({id:e.Id,eventId:e.EventContentId,groups:e.ScenarioGroupId,into:target.sourceKey,sources:[...new Set(sources)]});
    report.missingTitles.splice(report.missingTitles.indexOf(missing),1);
  }
  for(const c of data.contents){
    ensure(ints(c.ScenarioGroupId),'无效其他剧情 '+c.Id);
    c.ScenarioGroupId.forEach(g=>usedGroups.add(g));
    const t=title(loc.get(c.LocalizeId),null,'DB/LocalizeExcelTable.json#Key='+c.LocalizeId)||scriptTitle(c.ScenarioGroupId);
    if(!t){report.missingTitles.push({type:'contents',id:c.Id,groups:c.ScenarioGroupId,reason:'没有可用其他剧情标题'});continue;}
    const root='ba:contents';
    directory(root,'contents',null,{title:'其他剧情'},0);
    add({line:'contents',type:'其他剧情',volumeId:0,volumeName:'其他剧情',chapterId:null,chapterName:'',
      nodeId:c.Id,episode:'',order:c.DisplayOrder,sourceKey:'ba:contents:'+c.Id,scriptGroupIds:c.ScenarioGroupId,
      aliasIds:[],contentType:c.ScenarioContentType,...t,sourceFile:'DB/ContentsScenarioExcelTable.json#Id='+c.Id+'; '+t.sourceFile},root);
  }
  const cnChars=new Map((data.cnCharacters?.names||[]).map(x=>[x.Id,x.Name]));
  // Only exact Japanese base names establish a relationship; Chinese spellings
  // are never used to guess whether two entries represent the same character.
  const cnBases=new Map();
  for(const character of data.characters){
    const original=charLoc.get(character.LocalizeEtcId);
    const jp=clean(original?.Jp),name=clean(cnChars.get(character.Id));
    if(!jp||/[（()）]/.test(jp)||!name||/[（()）]/.test(name))continue;
    if(!cnBases.has(jp))cnBases.set(jp,[]);
    cnBases.get(jp).push({id:character.Id,name});
  }
  const characterNames=new Map();
  report.characterNames={source:data.cnCharacters?{
    repository:data.cnCharacters.repository,commit:data.cnCharacters.commit,path:data.cnCharacters.path
  }:null,inherited:[],pending:[]};
  for(const character of data.characters){
    const original=charLoc.get(character.LocalizeEtcId);
    let name=title(original,null,'DB/LocalizeEtcExcelTable.json#Key='+character.LocalizeEtcId);
    if(!name){report.missingDirectories.push({characterId:character.Id});name={title:'角色 '+character.Id};}
    if(cnChars.has(character.Id))name={...name,title:cnChars.get(character.Id)};
    else{
      const jp=clean(original?.Jp).match(/^([^（()）]+)[（(]([^（()）]+)[）)]$/);
      const tw=clean(original?.Tw).match(/^([^（()）]+)[（(]([^（()）]+)[）)]$/);
      const candidates=jp?cnBases.get(jp[1]):null;
      if(tw&&candidates?.length===1){
        const base=candidates[0],before=name.title;
        // Keep the source costume description. Only the verified character
        // name is inherited; this is not an independently verified CN title.
        name={...name,title:base.name+'（'+simplify(tw[2])+'）'};
        report.characterNames.inherited.push({characterId:character.Id,baseCharacterId:base.id,
          before,title:name.title,rawTitle:original.Tw});
      }else report.characterNames.pending.push({characterId:character.Id,title:name.title,rawTitle:name.rawTitle});
    }
    characterNames.set(character.Id,name);
  }
  for(const f of data.favors){
    if(excludedFavorIds.has(f.Id))continue;
    ensure(Number.isSafeInteger(f.OrderInGroup)&&f.OrderInGroup>=0,'无效羁绊顺序 '+f.Id);
    const groups=[f.ScenarioSriptGroupId];
    groups.forEach(x=>usedGroups.add(x));
    const t=title(loc.get(f.LocalizeScenarioId),null,'DB/LocalizeExcelTable.json#Key='+f.LocalizeScenarioId)||scriptTitle(groups);
    if(!t){report.missingTitles.push({type:'favor',id:f.Id,groups,reason:charLoc.get(chars.get(f.CharacterId)?.LocalizeEtcId)?.Tw==='LocalizeError'?'角色名称为 LocalizeError，羁绊标题为空；保留待核实':'没有可用羁绊标题'});continue;}
    const character=chars.get(f.CharacterId);
    ensure(character,'缺少角色 '+f.CharacterId);
    const vn=characterNames.get(f.CharacterId);
    const root='ba:character:'+f.CharacterId;
    directory(root,'favor',null,vn,f.CharacterId);
    add({
      line:'favor',type:'羁绊',volumeId:f.CharacterId,volumeName:vn.title,chapterId:null,chapterName:'',
      nodeId:f.Id,episode:f.OrderInGroup,order:f.OrderInGroup,
      sourceKey:'ba:favor:'+f.Id,scriptGroupIds:groups,aliasIds:[],localizeId:f.LocalizeScenarioId,...t,
      sourceFile:'DB/AcademyFavorScheduleExcelTable.json#Id='+f.Id+'; '+t.sourceFile,
    },root);
  }
  rows.sort((a,b)=>lines.find(x=>x.id===a.line).order-lines.find(x=>x.id===b.line).order || containers.get(containers.get(a.parentKey)?.parentKey||a.parentKey).order-containers.get(containers.get(b.parentKey)?.parentKey||b.parentKey).order || (a.chapterId||0)-(b.chapterId||0) || a.order-b.order || a.nodeId-b.nodeId);
  for(const line of lines)report.counts[line.title]=rows.filter(x=>x.line===line.id).length;
  report.total=rows.length;
  report.nodeCount=nodes.length;
  report.excludedRecordCount=report.excludedRecords.length;
  report.missingTitleCount=report.missingTitles.length;
  report.missingTitleSummary={sourceRecordCount:report.missingTitles.length,uniqueGroupCount:new Set(report.missingTitles.map(x=>x.type+':'+x.groups.join(','))).size,note:'源表片段数不等于缺少的完整剧情数；未根据相邻顺序推断合并。'};
  for(const item of report.missingTitles.filter(x=>x.type==='events')){
    const season=seasons.get(item.eventId);
    item.originalEventId=season.OriginalEventContentId;
    item.eventName=local(season.Name)?.title||'活动 '+item.originalEventId;
    item.sourceFile='DB/EventContentScenarioExcelTable.json#Id='+item.id;
  }
  report.duplicateSourceKeyCount=0;
  report.cnVerifiedTitleCount=rows.filter(x=>x.titleLanguage.startsWith('zh-CN')).length;
  report.cnCharacterNameCount=cnChars.size;
  report.pendingCnTitleCount=rows.filter(x=>x.titleLanguage.startsWith('zh-TW')).length;
  report.untranslatedTitleCount=rows.filter(x=>x.titleLanguage.startsWith('ja')).length;
  report.unreferencedTitleGroups=[...scripts.keys()].filter(x=>!usedGroups.has(x));
  report.unreferencedTitleDetails=report.unreferencedTitleGroups.map(groupId=>({groupId,titles:scripts.get(groupId).map(x=>({Tw:clean(x.Tw),Jp:clean(x.Jp)})),reason:scripts.get(groupId).some(x=>clean(x.Tw)||clean(x.Jp))?'有标题但未关联目录；暂不添加':'标题为空，未关联目录'}));
  const repeated=new Map();
  for(const r of rows){const k=r.parentKey+'|'+r.title;if(!repeated.has(k))repeated.set(k,[]);repeated.get(k).push(r.sourceKey);}
  report.repeatedTitles=[...repeated.entries()].filter(([,v])=>v.length>1).map(([title,keys])=>({title,keys}));
  report.samples=Object.fromEntries(lines.map(l=>[l.title,rows.filter(r=>r.line===l.id).slice(0,3)]));
  for(const node of nodes.filter(n=>n.storyLineId==='events')){
    const eventId=Number((node.parentKey||node.sourceKey).split(':')[2]);
    node.releasedAt=eventDates.get(eventId)?.releasedAt||null;
  }
  for(const row of rows.filter(r=>r.line==='events'))row.releasedAt=eventDates.get(row.volumeId)?.releasedAt||null;
  const activityRoots=nodes.filter(n=>n.storyLineId==='events'&&n.parentKey===null);
  report.eventDates={server:'CN',checkedAt:cn.eventDates?.checkedAt||null,
    source:'国服官网首次活动开放日期',
    filled:activityRoots.filter(n=>n.releasedAt).length,total:activityRoots.length,
    entries:activityRoots.filter(n=>n.releasedAt).map(n=>({...eventDates.get(Number(n.sourceKey.split(':')[2])),title:n.title})),
    missing:activityRoots.filter(n=>!n.releasedAt).map(n=>({eventId:Number(n.sourceKey.split(':')[2]),title:n.title}))};
  const byNodeKey=new Map(nodes.map(n=>[n.sourceKey,n]));
  const mainRows=rows.filter(r=>r.line==='main');
  for(const row of mainRows){
    row.releasedAt=mainDates.get(row.nodeId)?.releasedAt||null;
    byNodeKey.get(row.sourceKey).releasedAt=row.releasedAt;
    if(!row.releasedAt)continue;
    let parent=byNodeKey.get(row.parentKey);
    while(parent){
      if(!parent.releasedAt||row.releasedAt<parent.releasedAt)parent.releasedAt=row.releasedAt;
      parent=byNodeKey.get(parent.parentKey);
    }
  }
  const missingMain=new Map();
  for(const row of mainRows.filter(r=>!r.releasedAt)){
    const key=[row.modeType,row.series,row.volumeId,row.chapterId].join(':');
    if(!missingMain.has(key))missingMain.set(key,{modeType:row.modeType,series:row.series,volumeId:row.volumeId,
      chapterId:row.chapterId,title:row.volumeName+' / '+row.chapterName,episodes:[]});
    missingMain.get(key).episodes.push(row.episode);
  }
  report.mainDates={server:'CN',checkedAt:cn.mainDates?.checkedAt||null,
    source:'国服官网主线各批次首次开放日期',filled:mainRows.filter(r=>r.releasedAt).length,total:mainRows.length,
    entries:mainDateEntries,missing:[...missingMain.values()]};
  const warnings=[
    '使用 global 标题目录 '+data.source.version+'（'+data.source.committedAt.slice(0,10)+'）；不代表国服当前进度。',
    '活动日期使用国服首次开放日期：'+report.eventDates.filled+' / '+report.eventDates.total+' 个活动已核实；'+report.eventDates.missing.length+' 个暂无国服开放记录，日期留空。',
    '主线日期使用国服各批次首次开放日期：'+report.mainDates.filled+' / '+report.mainDates.total+' 条剧情已核实；'+(report.mainDates.total-report.mainDates.filled)+' 条暂无国服开放记录，日期留空；其他类型日期暂未提取。',
    report.cnVerifiedTitleCount+' 条标题已对照简中来源；'+report.pendingCnTitleCount+' 条为繁中转简体、待简中核对；'+report.untranslatedTitleCount+' 条保留日文、待翻译。',
    report.missingTitleCount+' 条源表记录缺少可用标题，未纳入；详见 ba_story_report.json。',
    '独立小游戏剧情与网页活动不计入；'+report.eventSegments.length+' 条无标题活动片段已按明确关联归入现有剧情。',
  ];
  if(report.missingDirectories.length)warnings.push(report.missingDirectories.length+' 个目录名称缺失，暂以来源 ID 展示。');
  return {
    rows,report,
    output:{apiVersion:1,catalog:{importerId:'ba-data',game:{id:'blue-archive',title:'蔚蓝档案'},
      storyLines:lines.filter(l=>rows.some(r=>r.line===l.id)),nodes},warnings},
  };
}
export function csv(rows){
  const columns=[
    ['类型','type'],['卷或活动ID','volumeId'],['卷或活动名称','volumeName'],
    ['章ID','chapterId'],['章名称','chapterName'],['节点ID','nodeId'],['话数','episode'],
    ['顺序','order'],['国服开放日期','releasedAt'],['标题','title'],['原始标题','rawTitle'],['标题语言','titleLanguage'],
    ['来源文件','sourceFile'],['稳定来源键','sourceKey'],['剧情组ID','scriptGroupIds'],['合并来源ID','aliasIds'],
  ];
  const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  return '\uFEFF'+[columns.map(([label])=>quote(label)).join(','),
    ...rows.map(r=>columns.map(([,k])=>quote(Array.isArray(r[k])?r[k].join(';'):r[k])).join(','))].join('\r\n')+'\r\n';
}
