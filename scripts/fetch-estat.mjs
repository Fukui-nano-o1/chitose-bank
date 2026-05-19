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
  // Step 1: 野菜の年間計テーブルを検索（全品目まとめ）
  const listUrl = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList'
    + '?appId=' + appId
    + '&lang=J'
    + '&searchWord=' + encodeURIComponent('作物統計 野菜 年間計 品目別')
    + '&limit=20';

  let listData = await fetchJSON(listUrl);
  let tables = listData?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF;

  // 年間計が見つからなければ品目別で再検索
  if (!tables) {
    const listUrl2 = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList'
      + '?appId=' + appId
      + '&lang=J'
      + '&searchWord=' + encodeURIComponent('野菜 品目別 作付面積 収穫量 全国')
      + '&limit=20';
    listData = await fetchJSON(listUrl2);
    tables = listData?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF;
  }

  if (!tables) {
    console.log('No tables found.');
    return;
  }

  const tableArr = Array.isArray(tables) ? tables : [tables];
  console.log('Found ' + tableArr.length + ' tables:');
  tableArr.forEach(t => {
    const title = t.TITLE_SPEC ?
      (t.TITLE_SPEC.TABLE_NAME + ' / ' + (t.TITLE_SPEC.TABLE_SUB_CATEGORY1 || '') + ' / ' + (t.TITLE_SPEC.TABLE_EXPLANATION || '')) :
      (t.TITLE || 'unknown');
    console.log('  ID=' + t['@id'] + ' Title=' + title + ' Survey=' + (t.TITLE_SPEC?.STAT_NAME || ''));
  });

  // Step 2: 全テーブルからデータを収集
  const allRows = {};

  for (const table of tableArr) {
    const tableId = table['@id'];
    const tableTitle = table.TITLE_SPEC ?
      (table.TITLE_SPEC.TABLE_SUB_CATEGORY1 || table.TITLE_SPEC.TABLE_NAME || '') :
      (table.TITLE || '');

    console.log('\nProcessing table ' + tableId + ': ' + tableTitle);

    try {
      const dataUrl = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData'
        + '?appId=' + appId
        + '&lang=J'
        + '&statsDataId=' + tableId
        + '&limit=100000';

      const statsData = await fetchJSON(dataUrl);
      const statBody = statsData?.GET_STATS_DATA?.STATISTICAL_DATA;
      if (!statBody) { console.log('  No data'); continue; }

      const classObjs = Array.isArray(statBody.CLASS_INF.CLASS_OBJ) ? statBody.CLASS_INF.CLASS_OBJ : [statBody.CLASS_INF.CLASS_OBJ];

      // クラスマップを構築
      const classMap = {};
      classObjs.forEach(c => {
        const classes = Array.isArray(c.CLASS) ? c.CLASS : [c.CLASS];
        classMap[c['@id']] = {};
        classes.forEach(cl => { classMap[c['@id']][cl['@code']] = cl['@name']; });
      });

      console.log('  Classes:', classObjs.map(c => c['@id'] + '(' + c['@name'] + ')').join(', '));

      const values = statBody.DATA_INF.VALUE;
      if (!Array.isArray(values)) { console.log('  No values array'); continue; }

      // データ構造に応じてパース
      values.forEach(v => {
        const val = parseFloat(v.$);
        if (isNaN(val)) return;

        // 全国データのみ
        const areaCode = v['@area'] || '';
        const areaName = classMap.area?.[areaCode] || '';
        if (areaCode !== '00001' && !areaName.includes('全国')) {
          // areaがない場合はスキップしない
          if (classMap.area && Object.keys(classMap.area).length > 0) return;
        }

        // 品目名を取得（cat01があれば使う、なければテーブルタイトルから）
        let cropName = '';
        if (v['@cat01'] && classMap.cat01) {
          cropName = classMap.cat01[v['@cat01']] || '';
        } else {
          cropName = tableTitle.replace(/（.*?）/g, '').trim();
        }
        if (!cropName) return;

        // 年次を取得（timeがあれば使う）
        let year = 0;
        if (v['@time'] && classMap.time) {
          const timeName = classMap.time[v['@time']] || '';
          const ym = timeName.match(/(\d{4})/);
          if (ym) year = parseInt(ym[1]);
        } else {
          // テーブルメタデータから年を推定
          const titleYear = tableTitle.match(/令和(\d+)|(\d{4})年/);
          if (titleYear) {
            year = titleYear[2] ? parseInt(titleYear[2]) : 2018 + parseInt(titleYear[1]);
          }
        }
        if (!year) return;

        // 指標名
        const metricCode = v['@cat02'] || '';
        const metricName = classMap.cat02?.[metricCode] || '';

        const key = cropName + '_' + year;
        if (!allRows[key]) allRows[key] = { crop: cropName, year: year };

        if (metricName.includes('作付面積') && !metricName.includes('対前年')) allRows[key].acreage_ha = val;
        else if (metricName.includes('10ａ当たり収量') || metricName.includes('10a当たり収量')) allRows[key].yield_kg_per_10a = val;
        else if (metricName.includes('収穫量') && !metricName.includes('対前年')) allRows[key].harvest_t = val;
      });

    } catch (err) {
      console.log('  Error processing table:', err.message);
    }
  }

  // Step 3: Supabaseに保存
  const rows = Object.values(allRows)
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

  console.log('\nTotal parsed: ' + rows.length + ' rows');
  if (rows.length > 0) {
    console.log('Sample:', JSON.stringify(rows.slice(0, 5)));
    await upsertToSupabase(rows);
  } else {
    console.log('No rows parsed.');
  }
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
