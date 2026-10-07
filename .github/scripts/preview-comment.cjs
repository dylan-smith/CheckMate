// Creates or updates the PR comment that links to the pull request's preview environment and says what state
// it's in. Run from actions/github-script, which passes in `github` and `context`. PREVIEW_STATUS is one of
// deploying, ready, failed, deleting, deleted or delete-failed. PREVIEW_FRONTEND_URL and PREVIEW_API_URL are the
// preview's origins once they're known. When PREVIEW_UPDATE_ONLY is 'true', an existing comment is updated but
// none is created (so a closed PR that never had a preview gets no comment).
module.exports = async ({ github, context }) => {
  const marker = '<!-- checkmate-preview -->';
  const status = process.env.PREVIEW_STATUS;
  const frontendUrl = process.env.PREVIEW_FRONTEND_URL;
  const apiUrl = process.env.PREVIEW_API_URL;
  const updateOnly = process.env.PREVIEW_UPDATE_ONLY === 'true';

  const { owner, repo } = context.repo;
  const issue_number = context.issue.number;
  const sha = context.payload.pull_request.head.sha.slice(0, 7);
  const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

  const statusLines = {
    deploying: `⏳ Deploying \`${sha}\`… ([workflow run](${runUrl}))`,
    ready: `✅ Ready. Deployed \`${sha}\` at ${now}.`,
    // A deployment updates the preview in place, so after a failure it may be down or only partly updated.
    failed:
      `❌ Deploying \`${sha}\` failed ([workflow run](${runUrl})). The preview may be unavailable or only ` +
      'partly updated until a later deployment succeeds.',
    deleting: '🧹 Deleting the preview environment now that the PR is closed…',
    deleted: `🗑️ The preview environment was deleted at ${now}.`,
    'delete-failed': `⚠️ Deleting the preview environment failed ([workflow run](${runUrl})). The cleanup after the next PR to close retries it.`,
  };
  if (!(status in statusLines)) {
    throw new Error(`Unknown PREVIEW_STATUS '${status}'`);
  }

  const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number });
  const existing = comments.find((c) => c.user.type === 'Bot' && c.body.startsWith(marker));

  const body = [marker, '# 🚀 Preview environment', statusLines[status]];
  if (frontendUrl && apiUrl) {
    body.push(
      [
        '| | |',
        '| --- | --- |',
        `| Frontend | ${frontendUrl} |`,
        `| API | ${apiUrl} |`,
        `| API reference | ${apiUrl}/scalar |`,
        `| Health | ${apiUrl}/health |`,
      ].join('\n'),
    );
  } else if (existing && status !== 'deleted') {
    // Updates made before the new URLs are known (or without them) keep the links to the preview that's still
    // running, until it's deleted.
    const table = existing.body.split('\n').filter((line) => line.startsWith('|'));
    if (table.length > 0) {
      body.push(table.join('\n'));
    }
  }
  body.push(
    'The preview has a database of its own, which starts with a few sample checklists, and is deleted when ' +
      'this PR is closed. It runs on a free plan, so the first request after a while can take a minute while ' +
      'the app and database start.',
  );

  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body: body.join('\n\n') });
  } else if (!updateOnly) {
    await github.rest.issues.createComment({ owner, repo, issue_number, body: body.join('\n\n') });
  }
};
