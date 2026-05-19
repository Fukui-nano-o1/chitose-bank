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
  // 令和5年産または最新の野菜41品目テーブルを検索
  const listUrl = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList'
    + '?appId=' + appId
    + '&lang=J'
    + '&searchWord=' + encodeURIComponent('野菜 41品目 作付面積 収穫量 出荷量 年間計')
    + '&limit=5';

  const listData = await fetchJSON(listUrl);
  let tables = listData?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF;

  if (!tables) {
    // 別のキーワードで再検索
    const listUrl2 = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList'
      + '?appId=' + appId
      + '&lang=J'
      + '&searchWord=' + encodeURIComponent('指定野菜 作付面積 収穫量 出荷量')
      + '&limit=10';
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

  // 最初のテーブルを使用
  const target = tableArr[0];
  console.log('\nSelected: ' + target['@id']);

  const dataUrl = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData'
    + '?appId=' + appId
    + '&lang=J'
    + '&statsDataId=' + target['@id']
    + '&limit=100000';

  const statsData = await fetchJSON(dataUrl);
  const statBody = statsData?.GET_STATS_DATA?.STATISTICAL_DATA;
  if (!statBody) { console.log('No data body'); return; }

  // クラス情報を全て表示
  const classObjs = Array.isArray(statBody.CLASS_INF.CLASS_OBJ) ? statBody.CLASS_INF.CLASS_OBJ : [statBody.CLASS_INF.CLASS_OBJ];
  const classMap = {};

  classObjs.forEach(c => {
    const id = c['@id'];
    const name = c['@name'];
    const classes = Array.isArray(c.CLASS) ? c.CLASS : [c.CLASS];
    classMap[id] = {};
    classes.forEach(cl => { classMap[id][cl['@code']] = cl['@name']; });
    console.log('\n' + id + ' (' + name + '):');
    classes.forEach(cl => console.log('  ' + cl['@code'] + ' = ' + cl['@name']));
  });

  // データサンプルを詳細表示
  const values = Array.isArray(statBody.DATA_INF.VALUE) ? statBody.DATA_INF.VALUE : [];
  console.log('\nTotal values: ' + values.length);
  console.log('First 10 values:');
  values.slice(0, 10).forEach((v, i) => console.log('  [' + i + '] ' + JSON.stringify(v)));

  // パース試行：全キーを動的に処理
  const grouped = {};
  let parseCount = 0;

  values.forEach(v => {
    const val = parseFloat(v.$);
    if (isNaN(val) || v.$ === '-' || v.$ === '…' || v.$ === 'x') return;

    // 全ての@属性を取得
    const attrs = {};
    Object.keys(v).forEach(k => {
      if (k.startsWith('@') && k !== '@unit') {
        const cleanKey = k.replace('@', '');
        attrs[cleanKey] = v[k];
      }
    });

    // 全国を判定（areaキーがあれば00001のみ、なければ通す）
    if (attrs.area && attrs.area !== '00001') return;

    // 品目名を探す（classMapの各カテゴリから野菜名を検索）
    let cropName = '';
    let metricName = '';
    let year = 0;

    Object.keys(attrs).forEach(key => {
      const code = attrs[key];
      const name = classMap[key]?.[code] || '';

      // 年次判定
      if (key === 'time' || name.match(/\d{4}年/)) {
        const m = name.match(/(\d{4})/);
        if (m) year = parseInt(m[1]);
      }
      // 指標判定（作付面積、収穫量等）
      else if (name.includes('作付面積') || name.includes('収穫量') || name.includes('10ａ') || name.includes('10a') || name.includes('出荷量')) {
        metricName = name;
      }
      // 品目判定（上記以外で、全国/地域名でもなく、施設/露地でもない名前）
      else if (name && !name.includes('全国') && !name.includes('都府県') && !name.includes('施設') && !name.includes('露地') && !name.includes('計') && name.length < 20) {
        if (!cropName) cropName = name;
      }
    });

    if (!cropName || !metricName) return;
    if (!year) year = 2024; // 年次がない場合はデフォルト

    const key = cropName + '_' + year;
    if (!grouped[key]) grouped[key] = { crop: cropName, year: year };

    if (metricName.includes('作付面積')) grouped[key].acreage_ha = val;
    else if (metricName.includes('10ａ当たり') || metricName.includes('10a当たり')) grouped[key].yield_kg_per_10a = val;
    else if (metricName.includes('収穫量')) grouped[key].harvest_t = val;

    parseCount++;
  });

  console.log('\nParse hits: ' + parseCount);

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

  console.log('Final rows: ' + rows.length);
  if (rows.length > 0) {
    console.log('Crops found:', [...new Set(rows.map(r => r.crop))].join(', '));
    console.log('Sample:', JSON.stringify(rows.slice(0, 3)));
    await upsertToSupabase(rows);
  } else {
    console.log('No rows. Check class mappings and sample values above.');
  }
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
