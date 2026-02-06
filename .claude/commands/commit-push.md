Commit all current changes, bump the version, and push to remote.

## Steps

1. Run `git status` and `git diff --staged` and `git diff` to see all changes. Also run `git log --oneline -5` to see recent commit style.

2. If there are no changes (no untracked files, no modifications, no staged changes), tell the user there's nothing to commit and stop.

3. Stage all changed/untracked files with `git add -A`.

4. Write a concise commit message summarizing the changes. Follow the existing commit message style from the log.

5. Analyze the changes and automatically determine the appropriate semver bump:
   - **patch**: bug fixes, small tweaks, non-breaking changes
   - **minor**: new features, enhancements (backward-compatible)
   - **major**: breaking changes

6. Read `package.json`, bump the `"version"` field according to the user's choice, and write it back.

7. Stage the updated `package.json` and create the commit with the message, ending with:
   ```
   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   ```

8. Push to the remote with `git push`.

9. Report the new version number and the commit hash to the user.
