---
status: 'accepted'
---

# The gates port the standard's script checks and accept declared map rows

Decided 2026-11-05 (sdd-enforce 1.0.0). A docs audit grades a repository against a docs standard. Its script checks ran
only when someone ran the audit, so drift came back between two audits. One repository needed 11 audit rounds
to reach the top level. sdd-enforce 1.0.0 ports those checks to Node inside `check-docs`: the rubric's script
criteria, and each migration detect check that a script can decide. The gates then fail on each finding at
every commit and in CI, with no extra tool. `.agent-sdd/config.json` names the standard and the version that
the ported checks follow. `audit --standard <dir>` warns when the installed standard is newer. A repository may
keep a home that the standard does not name, for example concern docs in a `docs/` subfolder. Its `docs/map.md`
then declares the folder as an added row. The gates accept that home, and only that home.

Declined:

- Read the standard's migration files at run time: CI then needs a copy of the standard. A copy in the
  repository breaks "one fact, one home". It would be right if CI could reach the installed standard.
- Call the audit's own fact script from the gates: CI then needs Python and the standard's plugin. It would be
  right if every CI agent had both.
- Fail every home the standard does not name: some added rows are still open questions to the standard's
  owners. A repository with one would move its docs twice. It would be right once the standard forbids added
  homes.
