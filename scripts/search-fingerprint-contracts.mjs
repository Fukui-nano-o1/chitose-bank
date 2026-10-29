// Fail-closed, syntax-aware extraction for the search contracts that outgrew the
// 2026-08 textual anchors. No application module is imported or executed here.
import ts from 'typescript';

const printer = ts.createPrinter({ removeComments: true });

// Reparse the printed fragment so only whitespace OUTSIDE literal tokens is
// folded. A blanket regex would also fold strings, templates and regular
// expressions. Wrappers make declarations/properties/JSX attributes parseable
// in isolation; their bytes are never included in the resulting fingerprint.
function normalizePrinted(node, printed) {
  const [prefix, suffix] = ts.isVariableDeclaration(node) ? ['const ', ';']
    : ts.isPropertyAssignment(node) ? ['({', '})']
    : ts.isJsxAttribute(node) ? ['<X ', ' />'] : ['', ''];
  const ast = ts.createSourceFile('fingerprint.jsx', prefix + printed + suffix, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  if (ast.parseDiagnostics.length) throw new Error('指紋の正規化用断片を解析できません');
  const ranges = walk(ast, child => ts.isStringLiteralLike(child) ||
    child.kind === ts.SyntaxKind.TemplateHead || child.kind === ts.SyntaxKind.TemplateMiddle ||
    child.kind === ts.SyntaxKind.TemplateTail || child.kind === ts.SyntaxKind.RegularExpressionLiteral ||
    ts.isJsxText(child)).map(child => [(ts.isJsxText(child) ? child.pos : child.getStart(ast)) - prefix.length, child.end - prefix.length])
    .filter(([start, end]) => start >= 0 && end <= printed.length).sort((a, b) => a[0] - b[0]);
  let end = 0, result = '';
  for (const [start, stop] of ranges) {
    result += printed.slice(end, start).replace(/\s+/g, ' ') + printed.slice(start, stop);
    end = stop;
  }
  return result + printed.slice(end).replace(/\s+/g, ' ');
}
function walk(node, predicate) {
  const found = [];
  const visit = child => { if (predicate(child)) found.push(child); ts.forEachChild(child, visit); };
  visit(node);
  return found;
}

function source(read, filename) {
  const text = read(filename);
  if (text == null) throw new Error(`指紋の必須ソースがありません: ${filename}`);
  const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true,
    filename.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length) throw new Error(`指紋のソースを解析できません: ${filename}`);
  const print = node => {
    // An alert's human-readable message does not change its branch or action.
    // Do not copy contact details from such messages into a second public file.
    const result = ts.transform(node, [context => {
      const visit = child => {
        if (ts.isCallExpression(child) && child.expression.getText(ast) === 'alert') {
          return ts.factory.updateCallExpression(child, child.expression, child.typeArguments,
            [ts.factory.createStringLiteral('<message>')]);
        }
        return ts.visitEachChild(child, visit, context);
      };
      return visit;
    }]);
    // Preserve every character inside strings/templates/JSX text. A whitespace
    // regex would also collapse literal values and hide changed storage/query keys.
    // JSON encoding keeps the canonical printer output on one lossless log line.
    try {
      const printed = printer.printNode(ts.EmitHint.Unspecified, result.transformed[0], ast).trim();
      return JSON.stringify(normalizePrinted(node, printed));
    }
    finally { result.dispose(); }
  };
  const requireOne = (nodes, name) => {
    if (nodes.length !== 1) throw new Error(`指紋の定義 ${name} は1つ必要です (${nodes.length}): ${filename}`);
    return nodes[0];
  };
  const named = (name, root = ast) => requireOne(walk(root, node =>
    (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) ||
    (ts.isFunctionDeclaration(node) && node.name?.text === name)), name);
  const calls = (name, root = ast) => walk(root, node =>
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name);
  const effects = (root = ast) => calls('useEffect', root);
  return { ast, print, named, calls, effects, requireOne };
}

export function collectSemanticContracts(read, add) {
  const map = source(read, 'src/components/JobLocationMap.jsx');
  const mapComponent = map.named('JobLocationMap');
  add('map:visitor', map.print(map.named('isVisitor', mapComponent)));
  add('map:authSource', map.print(map.named('authAlive', mapComponent)));
  add('map:session', map.print(map.named('useAuthAlive')));
  const mapEffects = map.effects(mapComponent);
  if (mapEffects.length !== 2) throw new Error('JobLocationMap の geocode/map effect は2つ必要です');
  // Entire effect includes early returns, asynchronous cancellation, all geometry,
  // interaction options, destruction, and its own dependency array. Nothing is cut.
  for (const effect of mapEffects) add('map:lifecycle', map.print(effect));
  const visitorReturn = map.requireOne(mapComponent.body.statements.filter(node =>
    ts.isIfStatement(node) && map.print(node.expression) === JSON.stringify('isVisitor')), 'visitor mosaic return');
  add('map:visitorRender', map.print(visitorReturn));
  const missingCoordinates = map.requireOne(mapComponent.body.statements.filter(node =>
    ts.isIfStatement(node) && map.print(node.expression) === JSON.stringify('lat == null || lng == null')), 'missing coordinates fallback');
  add('map:missingCoordinates', map.print(missingCoordinates));

  const search = source(read, 'src/features/jobs/search/JobSearchMapView.jsx');
  for (const name of ['myAppStatus', 'myAppLoaded', 'ownLoaded', 'isOwnJob', 'appPending',
    'applyBtnDisabled', 'applyBtnLabel', 'applyBtnStyle', 'applyBtnOnClick',
    'recruitClosed', 'appHasAction', 'hideApply', 'closedLabel', 'closedLabelShort',
    'isPeriodJob', 'periodDays', 'openApplicationPage', 'applySubmittingRef',
    'goPending', 'doApply', 'handleApply', 'cancelMyApplication']) {
    add(`apply:contract:${name}`, search.print(search.named(name)));
  }
  // The dedicated page is keyed by user + job; this replaces the old local
  // confirmation-box reset. Capture key, blocked/checking, handler and date props.
  const applicationElement = search.requireOne(walk(search.ast, node =>
    ts.isJsxSelfClosingElement(node) && node.tagName.getText(search.ast) === 'ApplicationPage'), 'ApplicationPage');
  const applicationPage = search.requireOne(walk(search.ast, node => ts.isIfStatement(node) &&
    node.getStart(search.ast) < applicationElement.getStart(search.ast) && node.end > applicationElement.end), 'ApplicationPage render condition');
  add('apply:page', search.print(applicationPage));
  for (const needle of ['readApplicationStep', 'cb_openApply']) {
    const effect = search.requireOne(search.effects().filter(node => node.getText(search.ast).includes(needle)), needle);
    add('apply:routeEffect', search.print(effect));
  }
  for (const name of ['searchActive', 'filteredList']) add('rule:search', search.print(search.named(name)));

  const page = source(read, 'src/features/jobs/search/components/ApplicationPage.jsx');
  for (const name of ['APPLICATION_STEPS', 'readApplicationStep', 'draftKey', 'dates',
    'unavailable', 'validDates', 'path', 'back', 'next', 'submit']) {
    add(`apply:page:${name}`, page.print(page.named(name)));
  }
  // Local availability must remain scoped to the current account and listing.
  const selection = page.requireOne(walk(page.ast, node => ts.isVariableDeclaration(node) &&
    ts.isArrayBindingPattern(node.name) && node.name.elements.some(element =>
      ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.name.text === 'selection')), 'selection');
  add('apply:page:selection', page.print(selection));
  const saveEffect = page.requireOne(page.effects().filter(node => node.getText(page.ast).includes('sessionStorage')), 'availability storage');
  add('apply:page:storage', page.print(saveEffect));
  const buttons = walk(page.ast, node => ts.isJsxOpeningElement(node) && node.tagName.getText(page.ast) === 'button');
  if (!buttons.length) throw new Error('ApplicationPage のボタンがありません');
  for (const button of buttons) {
    const attrs = button.attributes.properties.filter(attr => ts.isJsxAttribute(attr) && ['onClick', 'disabled'].includes(attr.name.text));
    add('apply:page:button', attrs.map(page.print).join(' | '));
  }
  const panels = source(read, 'src/features/jobs/search/components/ApplyPanel.jsx');
  for (const button of walk(panels.ast, node => ts.isJsxOpeningElement(node) && node.tagName.getText(panels.ast) === 'button')) {
    const attrs = button.attributes.properties.filter(attr => ts.isJsxAttribute(attr) && ['onClick', 'disabled'].includes(attr.name.text));
    // Keep pairs together; changing one button while another retains the guard
    // must fail (the renderer retains multiplicity rather than a global set).
    add('apply:panel:button', attrs.map(panels.print).join(' | '));
  }

  const jobs = source(read, 'src/features/jobs/search/searchJobs.js');
  for (const name of ['loadPublicJobs', 'fetchPublicJobs', 'orderSearchJobs', 'prefetchSearchJobs'])
    add(`rule:jobs:${name}`, jobs.print(jobs.named(name)));
  const visibility = source(read, 'src/lib/jobSearchVisibility.js');
  for (const name of ['refreshJobExpiry', 'isSearchJobVisible', 'visibleSearchJobs'])
    add(`rule:visibility:${name}`, visibility.print(visibility.named(name)));
  const status = source(read, 'src/features/jobs/model/jobStatus.js');
  for (const name of ['JOB_JST_OFFSET_MS', 'JOB_DAY_MS', 'jobDateYmd', 'jobEndTimeMs', 'isJobEnded'])
    add(`rule:expiry:${name}`, status.print(status.named(name)));
  const model = source(read, 'src/features/jobs/search/model.js');
  for (const name of ['normalizeDateRange', 'jobInDateRange'])
    add(`rule:dateRange:${name}`, model.print(model.named(name)));
  const presentation = source(read, 'src/features/jobs/model/jobPresentation.js');
  const mapper = presentation.named('mapJobPublicRow');
  for (const name of ['closed', 'filled', 'expired', 'isNew']) {
    const prop = presentation.requireOne(walk(mapper, node => ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) && node.name.text === name), `mapJobPublicRow.${name}`);
    add('rule:jobFlag', presentation.print(prop));
  }
  // Existing farmer/today sections also moved or changed syntax since August.
  // Follow their current owners rather than accepting empty regex results.
  const farmerLists = source(read, 'src/lib/farmerJobLists.js');
  add('farmer:classification', farmerLists.print(farmerLists.named('classifyFarmerJobs')));
  add('farmer:unpublished', status.print(status.named('isJobUnpublished')));
  const farmer = source(read, 'src/components/FarmerDashboard.jsx');
  for (const name of ['APP_HIDABLE', 'shown']) add('farmer:appFilter', farmer.print(farmer.named(name)));
  const today = source(read, 'src/components/TodayPage.jsx');
  for (const name of ['REMOVED_STAGES', 'TODO_META', 'TODO_STAGE_CATALOG'])
    add(`today:contract:${name}`, today.print(today.named(name)));
  const detail = source(read, 'src/lib/jobForMe.js');
  add('data:detailWindow', detail.print(detail.named('fetchJobRowsForMe')));
  // Dynamic .select([...].join(...)) and full argument values were invisible to
  // the old literal-only query scanner. Keep the full current API declarations.
  for (const [owner, filename] of [
    ['search', 'src/features/jobs/search/jobSearchApi.js'],
    ['today', 'src/features/today/todayApi.js'],
    ['farmer', 'src/features/farmer/dashboard/farmerDashboardApi.js'],
  ]) {
    const api = source(read, filename);
    for (const statement of api.ast.statements) {
      if (!statement.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations)
          add(`data:contract:${owner}`, api.print(declaration));
      } else if (ts.isFunctionDeclaration(statement)) add(`data:contract:${owner}`, api.print(statement));
    }
  }

}
