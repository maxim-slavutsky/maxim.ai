# Commit workflow

## Procedure

1. Read `changes-log.md`; compare with Git status. Log is intent source, diff is verification.
2. Confirm every changed path belongs to intended scope. Preserve unrelated user work.
3. Reconcile SPEC impact and agent parity impact before validation.
4. Run generated SDD gate and repository-native affected tests/lint/types/build.
5. Stage exact paths; inspect staged diff and staged file list.
6. Use repository commit convention. Do not bypass hooks.
7. Runtime edit without owner change needs trailer:

   ```text
   Spec-Impact: none - <at least 8 concrete words naming every unowned changed path>
   ```

8. One-sided harness edit needs trailer:

   ```text
   Agent-Parity: none - <concrete reason naming each one-sided harness path>
   ```

9. After successful commit, remove ignored `changes-log.md`.

Commit preparation does not grant permission to push, open a PR, merge, or delete branches/worktrees.
