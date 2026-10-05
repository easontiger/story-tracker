export const repository = 'electricgoat/ba-data';
export async function request(url, json = true) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'StoryTracker' }, signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
      return json ? await r.json() : await r.text();
    } catch (e) { error = e; }
  }
  throw error;
}
export async function table(commit, path) {
  const endpoints = [
    'https://cdn.jsdelivr.net/gh/' + repository + '@' + commit + '/' + path,
    'https://raw.githubusercontent.com/' + repository + '/' + commit + '/' + path,
  ];
  let error;
  for (const url of endpoints) {
    try {
      const d = await request(url);
      if (!Array.isArray(d.DataList)) throw new Error(path + ': 缺少 DataList');
      return d.DataList;
    } catch (e) { error = e; }
  }
  throw error;
}

export async function revision() {
  try {
    return await request('https://api.github.com/repos/' + repository + '/commits/global');
  } catch (error) {
    const feed = await request('https://github.com/' + repository + '/commits/global.atom', false);
    const entry = /<entry>([\s\S]*?)<\/entry>/.exec(feed)?.[1];
    const sha = /Grit::Commit\/([a-f0-9]{40})/.exec(entry || '')?.[1];
    const date = /<updated>([^<]+)<\/updated>/.exec(entry || '')?.[1];
    const name = /<title[^>]*>([\s\S]*?)<\/title>/.exec(entry || '')?.[1]?.trim();
    if (!sha || !date || !name) throw error;
    console.error('GitHub API 不可用，改用同一仓库的官方提交订阅源确认版本。');
    return {sha,commit:{committer:{date},message:name}};
  }
}
