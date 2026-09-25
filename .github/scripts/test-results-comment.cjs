// Creates or updates the PR comment that summarizes the backend, frontend and E2E test results.
// Run from actions/github-script, which passes in `github` and `context`. The test result summaries must
// already be downloaded to test-results/, and BACKEND_RESULT, FRONTEND_RESULT and E2E_RESULT hold each
// test job's result.
const fs = require('fs');

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
