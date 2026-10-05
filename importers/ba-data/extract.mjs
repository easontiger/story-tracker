import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, csv } from './parser.mjs';
import { refresh } from './refresh.mjs';
import { options } from './cli.mjs';
try{
  const opt=options(),root=dirname(fileURLToPath(import.meta.url));
  const dest=opt['out-dir']?resolve(opt['out-dir']):resolve(root,'../../src-tauri/target/release/export');
  const data=opt.refresh?await refresh():JSON.parse(await readFile(join(root,'data-snapshot.json'),'utf8'));
  const cn=JSON.parse(await readFile(join(root,'zh-cn.json'),'utf8'));
  const {rows,report,output}=build(data,cn);
  if(!opt.refresh)output.warnings.unshift('使用随模块提供的标题目录，未检查远程仓库更新。');
  await mkdir(dest,{recursive:true});
  await writeFile(join(dest,'ba_story_catalog.csv'),csv(rows),'utf8');
  await writeFile(join(dest,'ba_story_catalog.json'),JSON.stringify({source:data.source,rows},null,2)+'\n','utf8');
  await writeFile(join(dest,'ba_story_report.json'),JSON.stringify(report,null,2)+'\n','utf8');
  await writeFile(join(dest,'blue-archive.json'),JSON.stringify(output,null,2)+'\n','utf8');
  console.log(JSON.stringify({directory:dest,counts:report.counts,total:report.total,
    missingTitles:report.missingTitleCount,missingDirectories:report.missingDirectories.length,
    duplicateScriptGroups:report.duplicateScriptGroups.length,mergedNodes:report.mergedNodes.length,
    repeatedTitles:report.repeatedTitles.length,verifiedCnTitles:report.cnVerifiedTitleCount,
    untranslated:report.untranslatedTitleCount,unreferencedTitleGroups:report.unreferencedTitleGroups.length},null,2));
}catch(e){console.error('蔚蓝档案提取失败：'+e.message);process.exitCode=1;}
