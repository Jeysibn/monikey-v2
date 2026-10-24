# Documentation

Start with the [repository README](../README.md) for setup and the
[approved master plan](../MONIKEY_V2_MASTER_PLAN.md) for scope. Documents have
separate responsibilities so current instructions do not get buried in dated
validation reports.

| Question                              | Source of truth                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| What is approved?                     | [Master plan](../MONIKEY_V2_MASTER_PLAN.md) and [accepted ADRs](adr/)                                                                       |
| How is the system organized?          | [Architecture context](architecture/CONTEXT.md)                                                                                             |
| How do I develop and test?            | [Testing guide](development/TESTING.md)                                                                                                     |
| What is implemented or still pending? | [Implementation status](development/IMPLEMENTATION_STATUS.md)                                                                               |
| How do financial corrections work?    | [Correction rules](architecture/FINANCIAL_CORRECTIONS.md)                                                                                   |
| Which acceptance cases exist?         | [Financial matrix](qa/FINANCIAL_ACCEPTANCE_MATRIX.md)                                                                                       |
| What did reviewers actually verify?   | [QA index](qa/README.md)                                                                                                                    |
| How is a release prepared?            | [Release flow](release/RELEASE_FLOW.md), [readiness](release/PHASE6_READINESS.md), and [owner checklist](release/OWNER_REVIEW_CHECKLIST.md) |
| How are operations performed?         | [Runbooks](runbooks/)                                                                                                                       |
| What changed over time?               | [Changelog](CHANGELOG.md)                                                                                                                   |

## Layout and ownership

```text
docs/
  architecture/   Current technical behavior and boundaries
  adr/            Accepted decisions and their rationale
  design/         Design system, flows, and original design references
  development/    Repeatable testing instructions and implementation status
  release/        Release workflow, readiness, and owner gates
  runbooks/       Operational procedures
  qa/             Acceptance mappings and dated review evidence
    YYYY-MM-DD/   Reports and their screenshot assets
    history/      Preserved earlier validation record
```

Update current behavior in its architecture document and current procedures in
the testing guide or runbook. Add dated results under QA; preserve earlier
results with their source/date and limitations. Use relative links and keep
screenshots with the review that explains them. Add new entry points to this
index rather than another unclassified document at the documentation root.

Repository documentation is authoritative and portable. Obsidian holds the
working project journal and points back here. Deployment and V1-resource
changes still require explicit owner approval.
