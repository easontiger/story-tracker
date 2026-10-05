import { spawnSync } from 'node:child_process';
export function options() {
  const args=process.argv.slice(2),out={};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(['--refresh','--snapshot'].includes(arg))out[arg.slice(2)]=true;
    else if(['--output','--out-dir','--proxy'].includes(arg)&&args[i+1]&&!args[i+1].startsWith('--'))out[arg.slice(2)]=args[++i];
    else throw new Error('未知参数：'+arg);
  }
  if(out.refresh&&out.snapshot)throw new Error('--refresh 与 --snapshot 不能同时使用');
  if(out.proxy&&process.env.NODE_USE_ENV_PROXY!=='1'){
    const url=new URL(out.proxy);
    if(!['http:','https:'].includes(url.protocol))throw new Error('代理须使用 http 或 https');
    const copied=args.filter((x,i)=>x!=='--proxy'&&args[i-1]!=='--proxy');
    const child=spawnSync(process.execPath,[process.argv[1],...copied],{
      stdio:'inherit',windowsHide:true,
      env:{...process.env,HTTPS_PROXY:out.proxy,HTTP_PROXY:out.proxy,NODE_USE_ENV_PROXY:'1'},
    });
    if(child.error)throw child.error;
    process.exit(child.status??1);
  }
  return out;
}
