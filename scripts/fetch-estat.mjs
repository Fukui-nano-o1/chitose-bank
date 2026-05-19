const appId = process.env.ESTAT_APP_ID;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!appId) throw new Error('ESTAT_APP_ID is not set');
if (!supabaseUrl) throw new Error('SUPABASE_URL is not set');
if (!supabaseKey) throw new Error('SUPABASE_KEY is not set');

async function fetchJSON(url) {
  console.log('Fetching:', url.replace(appId, '***'));
  const res = await fetch(url);
  const text = await res.text();
  if (text.startsWith('<')) {
    console.error('Got HTML:', text.substring(0, 300));
    throw new Error('API returned HTML');
  }
  return JSON.parse(text);
}

async function upsertToSupabase(rows) {
  const res = await fetch(supabaseUrl + '/rest/v1/market_stats', {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': 'Bearer ' + supabaseKey,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error('Supabase error: ' + await res.text());
  console.log('Upserted ' + rows.length + ' rows');
}

async function main() {
  // Step 1: 作物統計調査の野菜テーブルを検索
  const listUrl = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList'
    + '?appId=' + appId
    + '&lang=J'
    + '&searchWord=' + encodeURIComponent('作物統計 野菜 全国')
    + '&limit=20';

  const listData = await fetchJSON(listUrl);
  const tables = listData?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF;

  if (!tables) {
    console.log('No tables found. Full response:', JSON.stringify(listData).substring(0, 1000));
    return;
  }

  const tableArr = Array.isArray(tables) ? tables : [tables];
  console.log('Found ' + tableArr.length + ' tables:');
  tableArr.forEach(t => {
    const title = t.TITLE_SPEC ? t.TITLE_SPEC.TABLE_NAME : (t.TITLE || 'unknown');
    console.log('  ID=' + t['@id'] + ' Title=' + title);
  });

  // Step 2: 収穫量データのテーブルを選択
  const target = tableArr.find(t => {
    const title = JSON.stringify(t.TITLE_SPEC || t.TITLE || '');
    return title.includes('収穫') || title.includes('作付');
  }) || tableArr[0];

  console.log('Selected table: ' + target['@id']);

  // Step 3: データ取得
  const dataUrl = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData'
    + '?appId=' + appId
    + '&lang=J'
    + '&statsDataId=' + target['@id']
    + '&limit=100000';

  const statsData = await fetchJSON(dataUrl);
  const statBody = statsData?.GET_STATS_DATA?.STATISTICAL_DATA;

  if (!statBody) {
    console.log('No statistical data. Response:', JSON.stringify(statsData).substring(0, 1000));
    return;
  }

  // Step 4: クラス情報を表示
  const classObjs = statBody.CLASS_INF.CLASS_OBJ;
  console.log('Class objects:');
  (Array.isArray(classObjs) ? classObjs : [classObjs]).forEach(c => {
    const classes = Array.isArray(c.CLASS) ? c.CLASS : [c.CLASS];
    console.log('  ' + c['@id'] + ' (' + c['@name'] + '): ' + classes.length + ' items');
    classes.slice(0, 5).forEach(cl => console.log('    ' + cl['@code'] + ' = ' + cl['@name']));
    if (classes.length > 5) console.log('    ... and ' + (classes.length - 5) + ' more');
  });

  // Step 5: データをパース
  const values = statBody.DATA_INF.VALUE;
  console.log('Total values: ' + values.length);
  console.log('Sample:', JSON.stringify(values.slice(0, 3)));

  // クラスマップを構築
  const classMap = {};
  (Array.isArray(classObjs) ? classObjs : [classObjs]).forEach(c => {
    const classes = Array.isArray(c.CLASS) ? c.CLASS : [c.CLASS];
    classMap[c['@id']] = {};
    classes.forEach(cl => { classMap[c['@id']][cl['@code']] = cl['@name']; });
  });

  // 全国データを品目×年×指標で集約
  const grouped = {};
  values.forEach(v => {
    const val = parseFloat(v.$);
    if (isNaN(val)) return;

    // 各カテゴリコードを取得
    const codes = {};
    Object.keys(v).forEach(k => {
      if (k.startsWith('@') && k !== '@unit') {
        codes[k.replace('@', '')] = v[k];
      }
    });

    // 全国のみ（area=00000 or コードが全国を示す）
    const areaCode = codes.area || codes.cat03 || '';
    const areaName = classMap.area?.[areaCode] || classMap.cat03?.[areaCode] || '';
    if (areaName && !areaName.includes('全国')) return;

    // 品目名
    const cropCode = codes.cat01 || '';
    const cropName = classMap.cat01?.[cropCode] || '';
    if (!cropName) return;

    // 年次
    const timeCode = codes.time || '';
    const timeName = classMap.time?.[timeCode] || '';
    const yearMatch = timeName.match(/(\d{4})/);
    if (!yearMatch) return;
    const year = parseInt(yearMatch[1]);

    // 指標名
    const metricCode = codes.cat02 || '';
    const metricName = classMap.cat02?.[metricCode] || '';

    const key = cropName + '_' + year;
    if (!grouped[key]) grouped[key] = { crop: cropName, year: year };

    if (metricName.includes('作付面積')) grouped[key].acreage_ha = val;
    else if (metricName.includes('収穫量')) grouped[key].harvest_t = val;
    else if (metricName.includes('10a当たり')) grouped[key].yield_kg_per_10a = val;
  });

  // Step 6: Supabaseに保存
  const rows = Object.values(grouped)
    .filter(r => r.acreage_ha || r.harvest_t || r.yield_kg_per_10a)
    .map(r => ({
      crop: r.crop,
      year: r.year,
      source: '農水省作物統計調査',
      market: 'national',
      acreage_ha: r.acreage_ha || null,
      harvest_t: r.harvest_t || null,
      yield_kg_per_10a: r.yield_kg_per_10a || null
    }));

  console.log('Parsed ' + rows.length + ' rows');
  if (rows.length > 0) {
    console.log('Sample rows:', JSON.stringify(rows.slice(0, 3)));
    await upsertToSupabase(rows);
  } else {
    console.log('No rows parsed. Check class mappings above.');
  }
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
