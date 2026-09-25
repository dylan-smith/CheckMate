// Posts the Bicep what-if output as a PR comment when it previews infrastructure changes. When there are no
// changes, no comment is created, and an earlier one (from a push that did have changes) is updated to say so,
// so it doesn't describe changes the PR no longer makes.
// Run from actions/github-script, which passes in `github` and `context`. WHAT_IF_OUTPUT is the path of the
// saved what-if output, and AZURE_SUBSCRIPTION_ID is redacted from it.
const fs = require('fs');

// GitHub rejects comment bodies over 65,536 characters; leave room for the rest of the comment.
const maxOutputLength = 60000;

module.exports = async ({ github, context }) => {
  const marker = '<!-- checkmate-what-if -->';
  let output = fs.readFileSync(process.env.WHAT_IF_OUTPUT, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (process.env.AZURE_SUBSCRIPTION_ID) {
    output = output.replaceAll(process.env.AZURE_SUBSCRIPTION_ID, '<subscription-id>');
  }
  // The Azure CLI prints this stats line when no resource changes remain after --exclude-change-types.
  // Potential changes (ones what-if can't predict for certain) are listed separately, and still count.
  const hasChanges = !output.includes('Resource changes: no change.') || output.includes('Potential changes:');

  const { owner, repo } = context.repo;
  const issue_number = context.issue.number;
  const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number });
  const existing = comments.find((c) => c.user.type === 'Bot' && c.body.startsWith(marker));
  const sha = context.payload.pull_request.head.sha;

  if (!hasChanges) {
    if (existing) {
      const body = [marker, '# Infrastructure What-If', `No infrastructure changes as of ${sha}.`].join('\n\n');
      await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    }
    return;
  }

  let shown = output;
  if (shown.length > maxOutputLength) {
    shown = `${shown.slice(0, maxOutputLength)}\n... (truncated, see the workflow run for the full output)`;
  }
  const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
  const body = [
    marker,
    '# Infrastructure What-If',
    `Merging ${sha} would make these changes to the production infrastructure ([workflow run](${runUrl})):`,
    '```diff',
    toDiffHighlighting(shown),
    '```',
  ].join('\n');

  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number, body });
  }
};

// What-if indents its change symbols (+ create, - delete, ~ modify, ...), but GitHub's diff highlighting only
// colors lines that start with + or -, so move each line's symbol to the start of the line.
function toDiffHighlighting(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^(\s+)([-+~=*x!])(\s)/, '$2$1$3'))
    .join('\n');
}
