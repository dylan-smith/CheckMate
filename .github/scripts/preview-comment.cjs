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
    failed: `❌ Deploying \`${sha}\` failed ([workflow run](${runUrl})). An earlier deployment, if any, is still running.`,
    deleting: '🧹 Deleting the preview environment now that the PR is closed…',
    deleted: `🗑️ The preview environment was deleted at ${now}.`,
    'delete-failed': `⚠️ Deleting the preview environment failed ([workflow run](${runUrl})). The weekly sweep retries it.`,
  };
  if (!(status in statusLines)) {
    throw new Error(`Unknown PREVIEW_STATUS '${status}'`);
  }

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
  }
  body.push(
    'The preview has an empty database of its own and is deleted when this PR is closed. It runs on a free ' +
      'plan, so the first request after a while can take a minute while the app and database start.',
  );

  const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number });
  const existing = comments.find((c) => c.user.type === 'Bot' && c.body.startsWith(marker));
  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body: body.join('\n\n') });
  } else if (!updateOnly) {
    await github.rest.issues.createComment({ owner, repo, issue_number, body: body.join('\n\n') });
  }
};
