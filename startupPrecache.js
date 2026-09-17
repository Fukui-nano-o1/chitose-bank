// Viteの実際の依存グラフから起動に必要なJS/CSSだけを選ぶ。
// ファイル名の手書きリストでは共有チャンクやCSSの取りこぼしが起きる。
export function collectStartupAssets(bundle) {
  const files = new Set();
  function visit(file) {
    if (files.has(file)) return;
    const chunk = bundle[file];
    if (!chunk || chunk.type !== 'chunk') return;
    files.add(file);
    for (const css of chunk.viteMetadata?.importedCss || []) files.add(css);
    for (const dependency of chunk.imports) visit(dependency);
    // dynamicImportsは開いた画面だけが要求する＝インストールを待たせない。
  }
  for (const chunk of Object.values(bundle)) {
    if (chunk.type === 'chunk' && chunk.isEntry) visit(chunk.fileName);
  }
  return files;
}

export function startupPrecache() {
  let files;
  return {
    plugin: {
      name: 'chitose-startup-precache',
      apply: 'build',
      enforce: 'post',
      generateBundle(_, bundle) { files = collectStartupAssets(bundle); },
    },
    transform(manifest) {
      if (!files?.size) throw new Error('起動チャンクの依存グラフを取得できませんでした');
      return {
        manifest: manifest.filter(entry => !entry.url.startsWith('assets/') || files.has(entry.url)),
        warnings: [],
      };
    },
  };
}
