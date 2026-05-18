// e-Stat API から野菜の作付面積・収穫量・10a当たり収量を取得して Supabase に保存する。
// 初回実行時はログで構造を確認し、パースロジックを調整すること。

const ESTAT_API = 'https://api.e-stat.go.jp/rest/3.0/app/json';
const appId = process.env.ESTAT_APP_ID;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

async function searchTables(keyword) {
  const url = `${ESTAT_API}/getStatsList?appId=${appId}&searchWord=${encodeURIComponent(keyword)}&limit=10`;
  const res = await fetch(url);
  const data = await res.json();
  return data.GET_STATS_LIST.DATALIST_INF.TABLE_INF;
}

async function getStatsData(statsDataId) {
  const url = `${ESTAT_API}/getStatsData?appId=${appId}&statsDataId=${statsDataId}&limit=100000`;
  const res = await fetch(url);
  const data = await res.json();
  return data.GET_STATS_DATA.STATISTICAL_DATA;
}

async function upsertToSupabase(rows) {
  const res = await fetch(`${supabaseUrl}/rest/v1/market_stats`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upsert failed: ${err}`);
  }
  console.log(`Upserted ${rows.length} rows`);
}

// e-Stat の VALUE 配列を品目×年次でグループ化し、market_stats 行に変換する。
// classInfo の構造は統計表によって異なるため、初回ログを確認してキーを調整すること。
function parseRows(dataArr, classInfo) {
  // 分類オブジェクトをマップ化（コード→名称）
  const buildMap = (obj) => {
    const items = Array.isArray(obj.CLASS) ? obj.CLASS : [obj.CLASS];
    return Object.fromEntries(items.map(c => [c['@code'], c['@name']]));
  };

  const catObj   = classInfo.find(c => c['@id'] === 'cat01');  // 品目
  const timeObj  = classInfo.find(c => c['@id'] === 'time');   // 年次
  const areaObj  = classInfo.find(c => c['@id'] === 'area');   // 地域
  const cat02Obj = classInfo.find(c => c['@id'] === 'cat02');  // 指標（面積/収穫量/収量）

  const cropMap    = catObj   ? buildMap(catObj)   : {};
  const timeMap    = timeObj  ? buildMap(timeObj)  : {};
  const areaMap    = areaObj  ? buildMap(areaObj)  : {};
  const metricMap  = cat02Obj ? buildMap(cat02Obj) : {};

  // 全国コードを特定（"00000" が多いが表によって異なる）
  const nationalCode = Object.entries(areaMap).find(([, v]) => v === '全国')?.[0]
    ?? '00000';

  // 品目×年次 でグループ化
  const grouped = {};
  for (const v of dataArr) {
    if (areaObj && v['@area'] !== nationalCode) continue;

    const cropCode   = v['@cat01'] ?? '';
    const timeCode   = v['@time'] ?? '';
    const metricCode = v['@cat02'] ?? '';
    const val        = parseFloat(v['$']);

    if (!cropCode || !timeCode || isNaN(val)) continue;

    const key = `${cropCode}__${timeCode}`;
    if (!grouped[key]) grouped[key] = { crop: cropMap[cropCode] ?? cropCode, year: timeCode.slice(0, 4) };

    const metricName = metricMap[metricCode] ?? metricCode;
    if (metricName.includes('作付面積') || metricName.includes('栽培面積')) {
      grouped[key].acreage_ha = val;
    } else if (metricName.includes('収穫量')) {
      grouped[key].harvest_t = val;
    } else if (metricName.includes('10a当たり収量') || metricName.includes('10a当たり収穫量')) {
      grouped[key].yield_kg_per_10a = val;
    }
  }

  return Object.values(grouped).map(r => ({
    crop:              r.crop,
    year:              parseInt(r.year, 10),
    source:            '農水省作物統計調査',
    market:            'national',
    acreage_ha:        r.acreage_ha        ?? null,
    harvest_t:         r.harvest_t         ?? null,
    yield_kg_per_10a:  r.yield_kg_per_10a  ?? null,
  })).filter(r => r.acreage_ha !== null || r.harvest_t !== null || r.yield_kg_per_10a !== null);
}

async function main() {
  console.log('Searching for vegetable crop statistics...');

  const tables = await searchTables('作物統計調査 野菜 収穫量');
  const tableArr = Array.isArray(tables) ? tables : [tables];
  console.log(`Found ${tableArr.length} tables`);

  for (const t of tableArr) {
    console.log(`ID: ${t['@id']}, Title: ${t.TITLE_SPEC?.TABLE_NAME ?? t.TITLE}`);
  }

  const targetTable = tableArr[0];
  const statsDataId = targetTable['@id'];
  console.log(`Fetching data from table: ${statsDataId}`);

  const statsData  = await getStatsData(statsDataId);
  const classInfo  = statsData.CLASS_INF.CLASS_OBJ;

  console.log('Class objects:', JSON.stringify(
    classInfo.map(c => ({ id: c['@id'], name: c['@name'] })),
    null, 2
  ));

  const dataArr = statsData.DATA_INF.VALUE;
  console.log(`Total data values: ${dataArr.length}`);
  console.log('Sample value:', JSON.stringify(dataArr[0]));

  const rows = parseRows(dataArr, classInfo);
  console.log(`Parsed ${rows.length} rows`);

  if (rows.length > 0) {
    await upsertToSupabase(rows);
  } else {
    console.log('No rows parsed. Check the data structure in logs above.');
    console.log('First 3 data values:', JSON.stringify(dataArr.slice(0, 3), null, 2));
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
