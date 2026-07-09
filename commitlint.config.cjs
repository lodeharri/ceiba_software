/**
 * Conventional commits enforcement.
 *
 * Allowed types come from @commitlint/config-conventional. PR 0 also adds a
 * body rule banning `Co-authored-by:` lines so AI-attribution cannot sneak
 * in via commit messages (per openspec/AGENTS.md "What NOT to do").
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 100],
    'footer-max-line-length': [2, 'always', 100],
  },
  ignores: [(commitMessage) => /Co-authored-by:\s*(?!Harri)/i.test(commitMessage)],
};
