# PRD content-module spec

Each server gets one Python module at `documentation/PRD/_build/content/<slug>.py` that
exposes a single module-level dict named `CONTENT`. The renderer (`prd_lib.render`)
turns it into a `.docx` styled by the HaorGrix PRD template.

## Shape

```python
CONTENT = {
    "title": "PRODUCT REQUIREMENTS DOCUMENT",
    "subtitle": "<Server display name> MCP Server",
    "tagline": "Single Source of Truth for Engineering, Design & Product",
    "sections": [ ...blocks... ],
}
```

## Block kinds

| kind | keys | renders as |
| --- | --- | --- |
| `h1` | `text` | Heading 1 (use for the numbered sections `1.`–`14.`) |
| `h2` | `text` | Heading 2 (use for `1.1`, `1.2`, …) |
| `para` | `text` | body paragraph |
| `meta` | `text` | small grey italic note — use sparingly, for scope caveats |
| `bullets` | `items` (list[str]) | bulleted list |
| `table` | `header` (list[str]), `rows` (list[list[str]]) | table; every row must match header width |
| `break` | — | page break |

Any other `kind`, or a row whose width differs from the header, raises `PRDBuildError`.

## Required sections — follow the template exactly

1. Document Control — 1.1 Version History, 1.2 Stakeholders & Sign-off, 1.3 Reference Documents
2. Overview & Summary — 2.1 Problem Statement, 2.2 Proposed Solution, 2.3 Background & Context, 2.4 Strategic Fit, 2.5 Objectives & Business Value
3. Goals & Success Metrics — 3.1 Goals (SMART), 3.2 Success Metrics / KPIs (table: Metric / Baseline / Target / Measurement Method), 3.3 Non-Goals
4. Target Audience & User Personas — 4.1 Primary Persona (table: Attribute / Detail), 4.2 Secondary Personas
5. Scope, User Stories & Requirements — 5.1 User Stories, 5.2 Functional Requirements (table: ID / Requirement / Priority / Acceptance Criteria; IDs `FR-1`…; MoSCoW priorities), 5.3 User Flows
6. Non-Functional Requirements (table: Category / Requirement — Performance, Scalability, Availability, Security, Privacy / Compliance, Accessibility, Observability, Localization)
7. Technical Considerations — 7.1 Architecture & Dependencies, 7.2 Data Model & APIs, 7.3 Integrations (table: Dependency / Owner / Type / Status), 7.4 Constraints & Assumptions, 7.5 Analytics & Instrumentation (table: Event / Trigger / Properties / Destination)
8. Design & UX
9. Release Plan & Milestones — 9.1 Phases (table: Milestone / Scope / Owner / Target Date), 9.2 Rollout Strategy, 9.3 Effort & Timeline (table: Workstream / Owner / Estimate / Dependencies), 9.4 Launch Readiness Checklist
10. Cost, Resourcing & Effort — 10.1 Team & Roles (table: Role / Person / Allocation), 10.2 Cost Considerations
11. Operations, Support & Maintenance — 11.1 Operational Ownership, 11.2 Support & Enablement, 11.3 Maintenance & Deprecation
12. Legal, Privacy & Compliance (table: Area / Consideration / Owner or Status)
13. Risks, Dependencies & Open Questions — 13.1 Risks (table: Risk / Likelihood / Impact / Mitigation), 13.2 Open Questions (table: Question / Owner / Status), 13.3 Decision Log (table: Date / Decision / Rationale / Decided By)
14. Appendix & Glossary — 14.1 Competitive / Market Analysis, 14.2 Glossary (table: Term / Definition), 14.3 Additional Notes & References

Add a `break` block before each of sections 5, 9, and 13 so the document paginates sensibly.

## Content rules

- **The full tool inventory is mandatory.** Section 5.2 must include one `FR-` row per
  functional capability group, and section 14.3 (or a dedicated table in 5.2) must list
  **every** tool by exact name with its read/write classification. Do not abbreviate with
  "…and others".
- Write from the *actual state of the code*, not aspiration. Where something is missing
  (no tests, no README, no HTTP transport, unbounded escape hatch), record it as a Risk,
  an Open Question, or a Non-Goal — do not invent that it exists.
- Fill every bracketed placeholder from the template with real content. Where a fact is
  genuinely unknown (a person's name, a date), use `TBD — <what is needed>` rather than
  inventing it. Owner org is **HaorGrix**; document owner is **Musfiqur Tuhin**.
- Version 0.1, Status Draft, Last Updated 2026-07-22.
- Repo is `HaorGrix/mcp-servers` (private monorepo), branch `main`. Reference the server
  by its folder path.
- These are internal developer tools consumed by AI agents through MCP over stdio — there
  is no end-user GUI. Section 8 (Design & UX) should say so plainly and then cover what
  *does* apply: tool naming conventions, description quality as the agent's only affordance,
  error-message legibility, and confirmation/guard ergonomics. Do not write "N/A" alone.
- Accessibility and Localization in section 6 should be answered honestly for a headless
  server (e.g. "N/A — no human-facing UI; operator-facing output is plain text").
- Tone: precise, factual, no marketing language, no em-dash-heavy prose padding.
