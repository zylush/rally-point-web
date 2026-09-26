# Exact-byte publisher regression evidence

User intent: publish the unchanged frozen r8 artifact without Git line-ending conversion; preserve user Git settings and the source worktree.

RED: a Node test stored the actual frozen `app/404.html` through Git's filtered `hash-object --path=404.html` with process-local `core.autocrlf=true`. The executed byte comparison failed: expected 411 bytes, actual 398, exactly the 13 lost CR bytes seen on Pages. This was an intentional local regression test, not a release gate failure.

GREEN: `scripts/exact-byte-tree.mjs` writes each raw Buffer with `git hash-object -w --no-filters --stdin`, constructs a separate index, and compares every blob and complete tree back to the supplied bytes. No config changes, checkout, commit, ref update or push occur in this helper.

Command actually run:

```text
node --test --experimental-test-coverage --test-coverage-include=scripts/exact-byte-tree.mjs tests/exact-byte-publisher.node-test.mjs
```

Three tests pass, with 100% helper line/branch/function coverage:

1. The frozen CRLF 404 file remains exact with autocrlf enabled.
2. Empty files, LF, mixed line endings, binary bytes, nested paths and spaces survive; an index reused for another tree contains no stale extra files.
3. Empty/duplicate inventories, unsafe paths, non-Buffer inputs and an invalid repository are rejected.

Integration evidence: all 20 frozen r8 deployment files were individually manifest-hashed, written to an isolated bare repository, and compared byte-for-byte in the tree before the authorized deployment commit/push. The seven-path diff was reviewed and checked; the three modified files differ only in line endings, with four obsolete non-artifact dotfiles removed. Details: `docs/STAGING-EXACT-BYTE-RETRY-20260923.md`.

No TDD checkpoint commits were made on the source branch because the user prohibited source commits. Tests are intentionally named `.node-test.mjs` and use Node's built-in runner rather than the app's Vitest runner. Hosted integration remains incomplete after an execution-sandbox network block; do not infer end-to-end acceptance from local coverage.
