import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseImportResult } from '../../src/catalog.ts';
import { build, csv } from './parser.mjs';
import { keyOf } from './refresh.mjs';
const data=JSON.parse(readFileSync(new URL('./data-snapshot.json',import.meta.url),'utf8'));
const cn=JSON.parse(readFileSync(new URL('./zh-cn.json',import.meta.url),'utf8'));
test('真实目录通过主程序校验，叶节点与阅读记录一一对应',()=>{
  const {output,rows,report}=build(data,cn);
  parseImportResult(output);
  const parents=new Set(output.catalog.nodes.map(n=>n.parentKey));
  assert.equal(output.catalog.nodes.filter(n=>!parents.has(n.sourceKey)).length,rows.length);
  assert.equal(rows.length,2527);
  assert.equal(new Set(output.catalog.nodes.map(n=>n.sourceKey)).size,output.catalog.nodes.length);
  assert.equal(output.catalog.storyLines.length,7);
  assert(output.catalog.nodes.filter(n=>!['main','events'].includes(n.storyLineId)).every(n=>n.releasedAt===null));
  assert.deepEqual(report.counts,{'主线':428,'活动':769,'社团':65,'羁绊':1105,'迷你故事':35,'特殊作战':96,'其他剧情':29});
});
test('简中名称、第二部命名空间与无正文输出',()=>{
  const {rows}=build(data,cn);
  assert.equal(rows.find(x=>x.nodeId===11040&&x.line==='main').title,'委员会的隐情');
  assert.equal(rows.find(x=>x.nodeId===11050&&x.line==='main').title,'芹香平凡的一天');
  assert.equal(rows.find(x=>x.nodeId===100002&&x.line==='favor').volumeName,'爱露');
  const second=rows.find(x=>x.series==='Series2'&&x.modeType==='Main');
  assert(second.sourceFile.includes('Main_Episode_Title_Series2_'));
  const serialized=JSON.stringify({rows,snapshot:data});
  assert(!/"(?:ScriptKr|DescriptionKr|ProfileIntroduction|TextEn|dialogue|summary)"\s*:/.test(serialized));
  assert.equal(keyOf('Main_Episode_Title_1_1_1'),1770695315);
});
test('改名、简中修订及源表重排不改变观看记录标识',()=>{
  const before=build(data,cn).output.catalog.nodes.map(n=>n.sourceKey).sort();
  const next=structuredClone(data),translation=structuredClone(cn);
  next.modes.reverse();next.favors.reverse();
  translation.episodes.find(x=>x.code==='Main_Episode_Title_1_1_1').title='新的核对标题';
  const after=build(next,translation).output.catalog.nodes.map(n=>n.sourceKey).sort();
  assert.deepEqual(after,before);
});
test('复刻只有原始活动映射和有序剧情组相同才合并，同标题独立节点保留',()=>{
  const next=structuredClone(data);
  next.events.push({...next.events.find(x=>x.Id===3),Id:999999,EventContentId:10801});
  const {rows,report}=build(next,cn);
  assert(rows.find(x=>x.sourceKey==='ba:event:801:groups:10000010').aliasIds.includes(999999));
  assert.equal(report.mergedNodes.length,build(data,cn).report.mergedNodes.length+1);
  const original=next.scriptTitles.find(x=>x.GroupId===10000010);
  next.scriptTitles.push({...original,GroupId:99999001});
  next.events.push({...next.events.find(x=>x.Id===3),Id:999998,ScenarioGroupId:[99999001]});
  const result=build(next,cn);
  assert(result.rows.some(x=>x.sourceKey==='ba:event:801:groups:99999001'));
  assert.equal(result.rows.length,2528);
});
test('未知和异常输入明确报告或停止，重复标题不按名称删除',()=>{
  const {rows,report}=build(data,cn);
  assert.equal(rows.filter(x=>x.parentKey==='ba:SpecialOperation:Series1:volume:1:chapter:2'&&x.title==='重逢').length,2);
  assert.equal(report.missingTitles.filter(x=>x.type==='favor').length,0);
  assert.equal(report.duplicateScriptGroups.length,1);
  assert(!data.events.some(e=>e.Id===708));
  assert(!data.favors.some(f=>[190172,190173,190175,190176].includes(f.Id)));
  const broken=structuredClone(data);broken.modes.push({...broken.modes[0]});
  assert.throws(()=>build(broken,cn),/重复 ModeId/);
  const missing=structuredClone(data);missing.events[0].EventContentId=99999;
  assert.throws(()=>build(missing,cn),/缺少父目录/);
  const invalid=structuredClone(cn);invalid.names.push({code:'Missing_Code',title:'错误',source:'https://example.com'});
  assert.throws(()=>build(data,invalid),/无法关联源表/);
});
test('CSV保留BOM、引号、逗号、标题原文和显式顺序',()=>{
  const {rows}=build(data,cn);
  const text=csv(rows);
  assert.deepEqual([...Buffer.from(text).subarray(0,3)],[239,187,191]);
  assert(text.includes('「')||text.includes('“'));
  const r={...rows[0],title:'标题,"引号"',rawTitle:'繁體原文'};
  assert(csv([r]).includes('"标题,""引号"""'));
  for(let i=1;i<rows.length;i++)if(rows[i].parentKey===rows[i-1].parentKey)assert(rows[i].order>=rows[i-1].order);
});

test('无标题片段只有明确关联才合并，已有记录键和输入不变',()=>{
  const before=JSON.stringify(data);
  const result=build(data,cn);
  assert.equal(JSON.stringify(data),before);
  assert.equal(result.report.eventSegments.length,115);
  assert.equal(result.report.missingTitleCount,0);
  assert.equal(result.report.missingDirectories.length,0);
  const stage=result.rows.find(x=>x.sourceKey==='ba:event:801:groups:10000040');
  assert(stage.scriptGroupIds.includes(10000045));
  assert(stage.aliasIds.includes(7));
  const unlinked=structuredClone(data);unlinked.stages=[];unlinked.eventChanges=[];
  const original=build(unlinked,cn);
  assert(original.report.missingTitles.some(x=>x.id===7&&x.type==='events'));
  assert.deepEqual(original.output.catalog.nodes.map(x=>x.sourceKey).sort(),result.output.catalog.nodes.map(x=>x.sourceKey).sort());
  assert.equal(result.report.unreferencedTitleDetails.filter(x=>x.titles.some(t=>t.Tw||t.Jp)).length,2);
});

test('小游戏按明确源表引用排除，普通活动主线保留',()=>{
  const excluded=build(data,cn);
  const included=build({...data,excludedGroups:[]},cn);
  const groups=new Set(data.excludedGroups.map(x=>x.groupId));
  assert.equal(excluded.report.excludedRecordCount,71);
  assert.equal(included.rows.length-excluded.rows.length,10);
  assert.equal(included.report.missingTitleCount-excluded.report.missingTitleCount,61);
  assert(excluded.report.excludedRecords.every(r=>r.groups.every(g=>groups.has(g))));
  assert(!excluded.rows.some(r=>r.line==='events'&&r.scriptGroupIds.every(g=>groups.has(g))));
  assert(excluded.rows.some(r=>r.sourceKey==='ba:event:807:groups:10006010'));
  assert(excluded.output.warnings.some(w=>w.includes('小游戏剧情与网页活动不计入')));
});

test('虚假的圣所攻略战按视频编号拆分，主线第21话保留且不重复',()=>{
  const result=build(data,cn);
  const activity=result.rows.filter(x=>x.volumeId===821&&x.line==='events');
  assert.equal(activity.length,16);
  assert.deepEqual(activity.map(x=>x.order),Array.from({length:16},(_,i)=>i+1));
  assert.equal(activity[0].title,'开战');
  assert.equal(activity[1].title,'第1圣塔（1）');
  assert.equal(activity[2].title,'第1圣塔（2）');
  assert.equal(activity[15].title,'最终圣塔（2）');
  assert(activity.every(x=>x.titleSourceUrl.includes('BV1MA411C7Qu')));
  const encounter=result.rows.filter(x=>x.title==='意料之外的相遇');
  assert.equal(encounter.length,1);
  assert.equal(encounter[0].sourceKey,'ba:mode:102210');
  assert.equal(encounter[0].episode,21);
  assert.equal(encounter[0].line,'main');
  const invalid=structuredClone(cn);invalid.events[0].groups=[999999];
  assert.throws(()=>build(data,invalid),/无法可靠关联源记录/);
});

test('百夜堂三组剧情分别保留两部分，既有观看标识不变',()=>{
  const {rows,report}=build(data,cn);
  const event=rows.filter(x=>x.line==='events'&&x.volumeId===815);
  assert.equal(event.length,13);
  for(const [first,second,title] of [[10013030,10013035,'硫磺矿工们'],[10013050,10013055,'白耳怪物们'],[10013060,10013065,'玄武的使者们']]){
    assert.equal(event.find(x=>x.sourceKey==='ba:event:815:groups:'+first).title,title+'（1）');
    assert.equal(event.find(x=>x.sourceKey==='ba:event:815:groups:'+second).title,title+'（2）');
  }
  assert.deepEqual(event.map(x=>x.order),Array.from({length:13},(_,i)=>i+1));
  assert(!report.missingTitles.some(x=>x.originalEventId===815));
});

test('方舟活动01单项、02至05分两项，复刻与原版共用九个节点',()=>{
  const {rows,report}=build(data,cn);
  const event=rows.filter(x=>x.line==='events'&&x.volumeId===822);
  assert.equal(event.length,9);
  assert.equal(event[0].title,'阿特拉哈西斯方舟占领战开始');
  for(let i=1;i<9;i+=2){assert(event[i].title.endsWith('（1）'));assert.equal(event[i+1].title,event[i].title.replace('（1）','（2）'));}
  assert(event.every(x=>x.aliasIds.length===1));
  assert.deepEqual(event.map(x=>x.aliasIds[0]),[384,385,386,387,388,389,390,391,392]);
  assert(!report.missingTitles.some(x=>x.originalEventId===822));
});

test('诱骗者连战连续剧情只生成一个节点，并保留八个有序剧情组',()=>{
  const result=build(data,cn);
  const event=result.rows.filter(x=>x.line==='events'&&x.volumeId===823);
  assert.equal(event.length,1);assert.equal(event[0].title,'诱骗者决战');
  assert.equal(event[0].sourceKey,'ba:event:823:groups:10021005');
  assert.deepEqual(event[0].scriptGroupIds,[10021005,10021010,10021015,10021016,10021017,10021020,10021021,10021022]);
  assert.deepEqual(event[0].aliasIds,[394,395,396,397,398]);
  assert(!result.report.missingTitles.some(x=>x.originalEventId===823));
  const shuffled=structuredClone(data);shuffled.events.reverse();
  const after=build(shuffled,cn).rows.find(x=>x.sourceKey===event[0].sourceKey);
  assert.deepEqual(after.scriptGroupIds,event[0].scriptGroupIds);
  const invalid=structuredClone(cn);invalid.eventMerges[0].recordIds.reverse();
  assert.throws(()=>build(data,invalid),/无法可靠关联/);
});

test('钢铁大陆补齐十二个后续片段，达阿特保持原节点与剧情组',()=>{
  const result=build(data,cn);const rows=result.rows.filter(x=>x.line==='events'&&x.volumeId===854);
  assert.equal(result.report.missingTitleCount,0);
  assert.equal(rows.length,29);
  for(const [first,second] of [[30001,30002],[30006,30007],[30008,30009],[30010,30011],[30013,30014],[30015,30016],[30017,30018],[30020,30021]]){
    const a=rows.find(x=>x.nodeId===first),b=rows.find(x=>x.nodeId===second);
    assert(a.title.endsWith('（1）'));assert.equal(b.title,a.title.replace('（1）','（2）'));
  }
  for(const ids of [[30027,30028,30029]]){
    const titles=ids.map(id=>rows.find(x=>x.nodeId===id).title);
    assert(titles[0].endsWith('（1）'));assert.equal(titles[1],titles[0].replace('（1）','（2）'));assert.equal(titles[2],titles[0].replace('（1）','（3）'));
  }
  assert.equal(rows.find(x=>x.nodeId===30024).title,'马尔库特：到达世界尽头的王国巡礼者');
  assert.equal(rows.find(x=>x.nodeId===30025).title,'达阿特（2）');
  assert.equal(rows.find(x=>x.nodeId===30026).title,'达阿特（3）前');
  const daat=rows.find(x=>x.nodeId===30023);
  assert.equal(daat.title,'达阿特：隐藏于阴影之下的深渊智慧');
  assert.equal(daat.sourceKey,'ba:event:854:groups:10052150-10052153-10052155');
  assert.deepEqual(daat.scriptGroupIds,[10052150,10052153,10052155]);
  assert(!cn.events.some(x=>x.recordId===30023));
});

test('国服首次活动日期写入活动和剧情，复刻不覆盖，未开放日期留空',()=>{
  const {output,rows,report}=build(data,cn);
  const node=key=>output.catalog.nodes.find(n=>n.sourceKey===key);
  assert.equal(node('ba:event:801').releasedAt,'2023-08-17');
  assert.equal(node('ba:event:801:groups:10000010').releasedAt,'2023-08-17');
  assert.equal(node('ba:event:831').releasedAt,'2025-11-20');
  assert.equal(node('ba:event:848').releasedAt,'2026-09-24');
  assert.equal(node('ba:event:80000').releasedAt,'2026-02-14');
  assert.equal(node('ba:event:854').releasedAt,null);
  assert.equal(report.eventDates.server,'CN');
  assert.equal(report.eventDates.filled,49);
  assert.equal(report.eventDates.missing.length,8);
  assert(rows.filter(r=>r.line==='events'&&r.volumeId===801).every(r=>r.releasedAt==='2023-08-17'));
  const withoutDates=structuredClone(cn);delete withoutDates.eventDates;delete withoutDates.mainDates;
  const original=build(data,withoutDates).output.catalog.nodes;
  assert.deepEqual(output.catalog.nodes.map(n=>({...n,releasedAt:null})),original);
  assert(csv(rows).includes('国服开放日期'));
});
test('异常、重复或其他服务器的日期拒绝生成目录',()=>{
  for(const kind of ['invalid','duplicate','foreign','unknown','source']){
    const next=structuredClone(cn);
    if(kind==='invalid')next.eventDates.entries[0].releasedAt='2023-02-30';
    if(kind==='duplicate')next.eventDates.entries.push(next.eventDates.entries[0]);
    if(kind==='foreign')next.eventDates.server='JP';
    if(kind==='unknown')next.eventDates.entries[0].eventId=999999;
    if(kind==='source')next.eventDates.entries[0].source='https://example.com/news/1';
    assert.throws(()=>build(data,next),/活动日期/);
  }
});

test('国服主线按话数批次记录日期，序章与后日谈单独核实',()=>{
  const {output,report}=build(data,cn);
  const date=key=>output.catalog.nodes.find(n=>n.sourceKey===key).releasedAt;
  assert.equal(date('ba:mode:10000'),'2023-08-03');
  assert.equal(date('ba:mode:11010'),'2023-08-03');
  assert.equal(date('ba:mode:12010'),'2023-08-10');
  assert.equal(date('ba:mode:31090'),'2023-09-28');
  assert.equal(date('ba:mode:31100'),'2023-10-12');
  assert.equal(date('ba:mode:13010'),'2025-08-14');
  assert.equal(date('ba:mode:13020'),'2025-10-23');
  assert.equal(date('ba:mode:13070'),'2025-10-23');
  assert.equal(date('ba:mode:13080'),'2025-12-04');
  assert.equal(date('ba:mode:13350'),'2026-01-29');
  assert.equal(date('ba:mode:51130'),'2025-07-03');
  assert.equal(date('ba:mode:51140'),'2025-07-10');
  assert.equal(date('ba:mode:52150'),'2026-08-20');
  assert.equal(date('ba:mode:52160'),'2026-08-27');
  assert.equal(date('ba:mode:104100'),'2024-12-19');
  assert.equal(date('ba:mode:104110'),'2025-01-02');
  assert.equal(date('ba:mode:104120'),'2025-01-16');
  assert.equal(date('ba:Main:Series1:volume:1'),'2023-08-03');
  assert.equal(date('ba:Main:Series1:volume:1:chapter:3'),'2025-08-14');
  assert.equal(date('ba:mode:61010'),null);
  assert.equal(date('ba:mode:200001'),null);
  assert.equal(date('ba:mode:201010'),null);
  assert.equal(report.mainDates.filled,381);
  assert.equal(report.mainDates.total,428);
  assert.equal(report.mainDates.entries.length,34);
  const previous=structuredClone(cn);delete previous.mainDates;
  const old=build(data,previous).output.catalog.nodes;
  assert.deepEqual(output.catalog.nodes.map(n=>({...n,releasedAt:n.storyLineId==='main'?null:n.releasedAt})),old);
});
test('国服主线日期拒绝重叠范围、错误范围与其他服务器来源',()=>{
  for(const kind of ['overlap','missing','date','foreign','series','source']){
    const next=structuredClone(cn);
    if(kind==='overlap')next.mainDates.entries.push({...next.mainDates.entries[0]});
    if(kind==='missing')next.mainDates.entries[1].lastEpisode=21;
    if(kind==='date')next.mainDates.entries[0].releasedAt='2023-02-30';
    if(kind==='foreign')next.mainDates.server='JP';
    if(kind==='series')next.mainDates.entries[1].series='Series2';
    if(kind==='source')next.mainDates.entries[0].source='https://example.com/news/1';
    assert.throws(()=>build(data,next),/主线日期/);
  }
});

test('换装角色按日文原名沿用简中姓名，保留来源换装描述与节点标识',()=>{
  const before=JSON.stringify(data);
  const {output,rows,report}=build(data,cn);
  const name=id=>output.catalog.nodes.find(n=>n.sourceKey==='ba:character:'+id).title;
  assert.equal(name(10037),'真里奈');
  assert.equal(name(10103),'真里奈（旗袍）');
  assert.equal(name(10057),'晴奈（正月）');
  assert.equal(name(10088),'佳代子（礼服）');
  assert.equal(name(20032),'艾米（泳装）');
  assert.equal(name(20038),'巴（旗袍）');
  assert.equal(name(26013),'亚津子（泳装）');
  assert.equal(rows.find(r=>r.sourceKey==='ba:favor:101032').volumeName,'真里奈（旗袍）');
  assert.equal(rows.find(r=>r.sourceKey==='ba:favor:101032').title,'谎言与真相');
  assert.equal(report.characterNames.inherited.find(r=>r.characterId===10103).baseCharacterId,10037);
  const changed=structuredClone(data);
  changed.cnCharacters.names.find(n=>n.Id===10037).Name='经核对的姓名';
  assert.deepEqual(build(changed,cn).output.catalog.nodes.map(n=>n.sourceKey).sort(),
    output.catalog.nodes.map(n=>n.sourceKey).sort());
  assert.equal(JSON.stringify(data),before);
});
test('独立简中名称优先；无精确关联或关联歧义时保留原名',()=>{
  const direct=structuredClone(data);
  direct.cnCharacters.names.push({Id:10103,Name:'独立核对的旗袍名称'});
  assert.equal(build(direct,cn).output.catalog.nodes.find(n=>n.sourceKey==='ba:character:10103').title,
    '独立核对的旗袍名称');
  const unknown=structuredClone(data);
  const key=unknown.characters.find(n=>n.Id===10103).LocalizeEtcId;
  unknown.characterNames.find(n=>n.Key===key).Jp='別人（チーパオ）';
  assert.equal(build(unknown,cn).output.catalog.nodes.find(n=>n.sourceKey==='ba:character:10103').title,
    '玛丽娜(旗袍)');
  const ambiguous=structuredClone(data);
  const otherKey=ambiguous.characters.find(n=>n.Id===10000).LocalizeEtcId;
  ambiguous.characterNames.find(n=>n.Key===otherKey).Jp='マリナ';
  assert.equal(build(ambiguous,cn).output.catalog.nodes.find(n=>n.sourceKey==='ba:character:10103').title,
    '玛丽娜(旗袍)');
});
