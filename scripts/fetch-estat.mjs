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
  // 全国まとめテーブルを直接取得（2つの候補）
  const targetIds = ['0003423833', '0001922161'];
  const allRows = {};

  for (const tableId of targetIds) {
    console.log('\n=== Fetching table ' + tableId + ' ===');
    try {
      const dataUrl = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData'
        + '?appId=' + appId
        + '&lang=J'
        + '&statsDataId=' + tableId
        + '&limit=100000';

      const statsData = await fetchJSON(dataUrl);
      const statBody = statsData?.GET_STATS_DATA?.STATISTICAL_DATA;
      if (!statBody) { console.log('No data'); continue; }

      // クラス情報を全表示
      const classObjs = Array.isArray(statBody.CLASS_INF.CLASS_OBJ) ? statBody.CLASS_INF.CLASS_OBJ : [statBody.CLASS_INF.CLASS_OBJ];
      const classMap = {};

      classObjs.forEach(c => {
        const id = c['@id'];
        const classes = Array.isArray(c.CLASS) ? c.CLASS : [c.CLASS];
        classMap[id] = {};
        classes.forEach(cl => { classMap[id][cl['@code']] = cl['@name']; });
        console.log(id + ' (' + c['@name'] + '): ' + classes.length + ' items');
        classes.slice(0, 10).forEach(cl => console.log('  ' + cl['@code'] + ' = ' + cl['@name']));
        if (classes.length > 10) console.log('  ...and ' + (classes.length - 10) + ' more');
      });

      const values = Array.isArray(statBody.DATA_INF.VALUE) ? statBody.DATA_INF.VALUE : [];
      console.log('Values: ' + values.length);
      if (values.length > 0) console.log('Sample: ' + JSON.stringify(values[0]));

      // パース：全属性キーを動的に判定
      values.forEach(v => {
        const val = parseFloat(v.$);
        if (isNaN(val) || v.$ === '-' || v.$ === '…' || v.$ === 'x') return;

        let cropName = '';
        let metricName = '';
        let year = 0;
        let isNational = false;

        Object.keys(v).forEach(k => {
          if (!k.startsWith('@') || k === '@unit') return;
          const dimId = k.replace('@', '');
          const code = v[k];
          const name = classMap[dimId]?.[code] || '';

          // time判定
          if (dimId === 'time') {
            const m = name.match(/(\d{4})/);
            if (m) year = parseInt(m[1]);
            return;
          }
          // area判定
          if (dimId === 'area') {
            if (code === '00000' || code === '00001' || name === '全国') isNational = true;
            return;
          }
          // 指標判定
          if (name === '作付面積' || name === '10ａ当たり収量' || name === '10a当たり収量' || name === '収穫量' || name === '出荷量') {
            metricName = name;
            return;
          }
          // 前年対比はスキップ
          if (name.includes('対比') || name.includes('前年')) return;
          if (name.includes('参考')) return;
          // 季節はスキップ
          if (['春', '夏', '秋', '冬', '秋冬', '春夏', '夏秋', '冬春', '春植え', '秋植え'].includes(name)) return;
          // 施設/露地はスキップ
          if (name === '施設' || name === '露地') return;

          // それ以外は品目名の候補
          if (name && name.length < 30 && !cropName) {
            cropName = name;
          }
        });

        // areaがないテーブルは全国扱い
        if (!classMap.area) isNational = true;
        if (!isNational) return;
        if (!cropName || !metricName) return;
        if (!year) year = 2024;

        // 「計」だけの品目名はスキップ
        if (cropName === '計' || cropName === '合計') return;

        const key = cropName + '_' + year;
        if (!allRows[key]) allRows[key] = { crop: cropName, year: year };

        if (metricName === '作付面積') allRows[key].acreage_ha = val;
        else if (metricName.includes('10') && metricName.includes('収量')) allRows[key].yield_kg_per_10a = val;
        else if (metricName === '収穫量') allRows[key].harvest_t = val;
      });

    } catch (err) {
      console.log('Error: ' + err.message);
    }
  }

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

  console.log('\nFinal: ' + rows.length + ' rows');
  if (rows.length > 0) {
    console.log('Crops:', [...new Set(rows.map(r => r.crop))].join(', '));
    console.log('Years:', [...new Set(rows.map(r => r.year))].sort().join(', '));
    console.log('Sample:', JSON.stringify(rows.slice(0, 3)));
    await upsertToSupabase(rows);
  }
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
