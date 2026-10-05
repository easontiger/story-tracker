import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './parser.mjs';
import { refresh } from './refresh.mjs';
import { options } from './cli.mjs';
try{
  const opt=options(),root=dirname(fileURLToPath(import.meta.url));
  const data=opt.refresh?await refresh():JSON.parse(await readFile(join(root,'data-snapshot.json'),'utf8'));
  const cn=JSON.parse(await readFile(join(root,'zh-cn.json'),'utf8'));
  const {output}=build(data,cn);
  if(!opt.refresh)output.warnings.unshift('使用随模块提供的标题目录，未检查远程仓库更新。');
  const json=JSON.stringify(output,null,2)+'\n';
  if(opt.output)await writeFile(resolve(opt.output),json,'utf8');
  else process.stdout.write(json);
}catch(e){console.error('蔚蓝档案导入失败：'+e.message);process.exitCode=1;}
