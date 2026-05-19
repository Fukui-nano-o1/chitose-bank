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
  // Step 1: 最新の指定野菜テーブル一覧を検索
  const listUrl = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList'
    + '?appId=' + appId
    + '&lang=J'
    + '&searchWord=' + encodeURIComponent('令和 指定野菜 作付面積 収穫量')
    + '&limit=50';

  const listData = await fetchJSON(listUrl);
  let tables = listData?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF;

  if (!tables) {
    const listUrl2 = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList'
      + '?appId=' + appId
      + '&lang=J'
      + '&searchWord=' + encodeURIComponent('令和 野菜 作付面積 収穫量 出荷量')
      + '&limit=50';
    const listData2 = await fetchJSON(listUrl2);
    tables = listData2?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF;
  }

  if (!tables) {
    console.log('No tables found with either search.');
    return;
  }

  const tableArr = Array.isArray(tables) ? tables : [tables];
  console.log('Found ' + tableArr.length + ' tables:');
  tableArr.forEach(t => {
    const sub = t.TITLE_SPEC?.TABLE_SUB_CATEGORY1 || '';
    const name = t.TITLE_SPEC?.TABLE_NAME || t.TITLE || '';
    const cycle = t.TITLE_SPEC?.TABLE_CYCLE || '';
    console.log('  ID=' + t['@id'] + ' ' + name + ' / ' + sub + ' [' + cycle + ']');
  });

  // Step 2: 全テーブルをループしてデータ収集
  const grouped = {};

  for (const table of tableArr) {
    // テーブルタイトルから品目名と年を抽出
    const cropName = (table.TITLE_SPEC?.TABLE_SUB_CATEGORY1 || '').trim();
    const titleText = table.TITLE_SPEC?.TABLE_NAME || table.TITLE || '';
    const reiwaMatch = titleText.match(/令和(\d+)年/);
    const heieiMatch = titleText.match(/平成(\d+)年/);
    let year = 0;
    if (reiwaMatch) year = 2018 + parseInt(reiwaMatch[1]);
    else if (heieiMatch) year = 1988 + parseInt(heieiMatch[1]);

    if (!cropName || !year) {
      console.log('  Skip (no crop/year): ' + table['@id'] + ' crop=' + cropName + ' year=' + year);
      continue;
    }

    console.log('\nProcessing: ' + table['@id'] + ' ' + cropName + ' ' + year + '年');

    try {
      const dataUrl = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData'
        + '?appId=' + appId
        + '&lang=J'
        + '&statsDataId=' + table['@id']
        + '&limit=100000';

      const statsData = await fetchJSON(dataUrl);
      const statBody = statsData?.GET_STATS_DATA?.STATISTICAL_DATA;
      if (!statBody) { console.log('  No data body'); continue; }

      const values = Array.isArray(statBody.DATA_INF.VALUE) ? statBody.DATA_INF.VALUE : [];

      // cat01="01"〜"04" かつ cat02="01"（年間計）のみ処理
      // cat01: "01"=作付面積, "02"=10a当たり収量, "03"=収穫量, "04"=出荷量
      const CAT01_MAP = { '01': 'acreage_ha', '02': 'yield_kg_per_10a', '03': 'harvest_t' };

      const key = cropName + '_' + year;
      if (!grouped[key]) grouped[key] = { crop: cropName, year: year };

      values.forEach(v => {
        const cat01 = v['@cat01'] || '';
        const cat02 = v['@cat02'] || '';
        if (cat02 !== '01') return;                  // 年間計以外（季節区分等）を除外
        if (!CAT01_MAP[cat01]) return;               // cat01="05"以降（対比%）を除外
        const val = parseFloat(v.$);
        if (isNaN(val) || v.$ === '-' || v.$ === '…' || v.$ === 'x') return;
        grouped[key][CAT01_MAP[cat01]] = val;
      });

      console.log('  -> ' + JSON.stringify(grouped[key]));
    } catch (err) {
      console.log('  Error: ' + err.message);
    }
  }

  // Step 3: Supabaseに保存
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

  console.log('\nFinal rows: ' + rows.length);
  if (rows.length > 0) {
    console.log('Crops found:', [...new Set(rows.map(r => r.crop))].join(', '));
    console.log('Sample:', JSON.stringify(rows.slice(0, 3)));
    await upsertToSupabase(rows);
  } else {
    console.log('No rows parsed. Check logs above.');
  }
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
