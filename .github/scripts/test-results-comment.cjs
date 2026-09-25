// Creates or updates the PR comment that summarizes the backend, frontend and E2E test results.
// Run from actions/github-script, which passes in `github` and `context`. The test result summaries must
// already be downloaded to test-results/, along with the backend and frontend coverage reports, and
// BACKEND_RESULT, FRONTEND_RESULT and E2E_RESULT hold each test job's result.
const fs = require('fs');
const path = require('path');

// A coverage table plus a per-file breakdown, from the backend's Cobertura report (Coverlet) and the
// frontend's JSON summary (Vitest).
function coverageSection() {
  const areas = [
    { title: 'Backend', file: 'backend-coverage.xml', read: coberturaByFile },
    { title: 'Frontend', file: 'frontend-coverage.json', read: vitestByFile },
  ];
  const rows = ['| Area | Lines | Branches |', '| --- | --- | --- |'];
  const details = [];
  for (const area of areas) {
    const file = `test-results/${area.file}`;
    if (!fs.existsSync(file)) {
      rows.push(`| ${area.title} | ⚠️ No coverage report | |`);
      continue;
    }
    const files = area.read(fs.readFileSync(file, 'utf8'));
    const total = files.reduce((sum, f) => addCounts(sum, f), emptyCounts());
    rows.push(`| ${area.title} | ${lineCoverage(total)} | ${branchCoverage(total)} |`);
    details.push(
      `<details><summary>${area.title} coverage by file</summary>`,
      ['| File | Lines | Branches |', '| --- | --- | --- |']
        .concat(files.map((f) => `| \`${f.name}\` | ${lineCoverage(f)} | ${branchCoverage(f)} |`))
        .join('\n'),
      '</details>',
    );
  }
  return ['## 📊 Code Coverage', rows.join('\n'), ...details];
}

// Totals each source file's lines and branches. A file can hold several classes (Coverlet reports async
// state machines and lambdas as their own), and the class and its methods both list a line, so each line
// number counts once per file.
function coberturaByFile(xml) {
  const byFile = new Map();
  for (const [, attrs, content] of xml.matchAll(/<class\b([^>]*)>([\s\S]*?)<\/class>/g)) {
    const name = attribute(attrs, 'filename').replaceAll('\\', '/');
    const lines = byFile.get(name) ?? new Map();
    byFile.set(name, lines);
    for (const [, lineAttrs] of content.replace(/<methods>[\s\S]*?<\/methods>/g, '').matchAll(/<line\b([^>]*)>/g)) {
      const number = attribute(lineAttrs, 'number');
      const branches = attribute(lineAttrs, 'condition-coverage').match(/\((\d+)\/(\d+)\)/);
      const previous = lines.get(number);
      lines.set(number, {
        covered: Number(attribute(lineAttrs, 'hits')) > 0 || (previous?.covered ?? false),
        branchesCovered: Math.max(Number(branches?.[1] ?? 0), previous?.branchesCovered ?? 0),
        branches: Math.max(Number(branches?.[2] ?? 0), previous?.branches ?? 0),
      });
    }
  }
  return [...byFile]
    .map(([name, lines]) => ({
      name,
      ...[...lines.values()].reduce(
        (sum, line) =>
          addCounts(sum, {
            lines: 1,
            linesCovered: line.covered ? 1 : 0,
            branches: line.branches,
            branchesCovered: line.branchesCovered,
          }),
        emptyCounts(),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Vitest's summary is keyed by absolute path on the frontend job's runner, which checks out to the same
// workspace path as this one.
function vitestByFile(json) {
  const frontend = path.join(process.env.GITHUB_WORKSPACE ?? '', 'frontend');
  return Object.entries(JSON.parse(json))
    .filter(([name]) => name !== 'total')
    .map(([name, { lines, branches }]) => ({
      name: path.relative(frontend, name).replaceAll('\\', '/'),
      lines: lines.total,
      linesCovered: lines.covered,
      branches: branches.total,
      branchesCovered: branches.covered,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function attribute(attrs, name) {
  return attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? '';
}

function emptyCounts() {
  return { lines: 0, linesCovered: 0, branches: 0, branchesCovered: 0 };
}

function addCounts(a, b) {
  return {
    lines: a.lines + b.lines,
    linesCovered: a.linesCovered + b.linesCovered,
    branches: a.branches + b.branches,
    branchesCovered: a.branchesCovered + b.branchesCovered,
  };
}

function lineCoverage(counts) {
  return percentage(counts.linesCovered, counts.lines);
}

function branchCoverage(counts) {
  return percentage(counts.branchesCovered, counts.branches);
}

function percentage(covered, total) {
  return total === 0 ? '—' : `${((covered / total) * 100).toFixed(1)}% (${covered}/${total})`;
}

module.exports = async ({ github, context }) => {
  const marker = '<!-- checkmate-test-results -->';
  const sections = [
    { title: 'Backend Tests', file: 'backend', result: process.env.BACKEND_RESULT },
    { title: 'Frontend Unit Tests', file: 'frontend', result: process.env.FRONTEND_RESULT },
    { title: 'E2E Tests', file: 'e2e', result: process.env.E2E_RESULT },
  ];

  // Each test job writes its results as JSON via publish-unit-test-result-action (json_file).
  const body = [marker, '# Test Results'];
  for (const section of sections) {
    const path = `test-results/${section.file}-test-results.json`;
    if (!fs.existsSync(path)) {
      body.push(`## ⚠️ ${section.title}`, `No test results were produced (job ${section.result}).`);
      continue;
    }
    const results = JSON.parse(fs.readFileSync(path, 'utf8'));
    const icon = results.conclusion === 'success' ? '✅' : '❌';
    body.push(`## ${icon} ${section.title}`, results.summary.trim());
    if (results.conclusion !== 'success') {
      body.push(`[View failure details](${results.check_url})`);
    }
  }
  body.push(...coverageSection());

  const { owner, repo } = context.repo;
  const issue_number = context.issue.number;
  const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number });
  const existing = comments.find((c) => c.user.type === 'Bot' && c.body.startsWith(marker));
  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body: body.join('\n\n') });
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number, body: body.join('\n\n') });
  }
};
