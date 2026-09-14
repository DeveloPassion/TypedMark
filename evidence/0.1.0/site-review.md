# Rendered reading-path review

Observed on 2026-09-14 against specification revision
`214cf865e1782804778ee08ff3a86f71aacf6960`, built on Windows with Bun 1.3.14.
This is bounded E4 evidence for specification #123, not a release approval or a
complete accessibility audit.

Chrome 152.0.7977.83 ran headlessly with a dedicated temporary profile and a
localhost-only site server. No personal browser profile or authenticated tabs
were used. Chrome DevTools MCP was unavailable; direct local DevTools protocol
observation supplied DOM, accessibility-tree, console, network and screenshots.

Reviewed pages: Overview, Getting Started, Quick Reference, Foundations, and
the 0.1 Migration checklist. Each loaded with the expected title and content,
without console errors/warnings or failed network requests after correction.
The overview and migration checklist expose the fixed prior-contract link;
the GitHub API independently confirmed that its baseline commit is accessible.
The normal 31-page build also checked all generated internal link targets and
anchors, including moved-rule references.

The initial browser check reproduced a Windows build bug: CRLF frontmatter was
rendered as headings and polluted page titles, audience badges and search.
The corrected builder accepts LF, CRLF and CR; three isolated real-build tests
verify the rendered output and unchanged source. An explicit empty favicon
removes the browser's failing implicit icon request without adding an asset or
network dependency. No specification semantics or artifact shapes changed.

The overview had no horizontal page overflow at 320, 768, 1024 and 1440 CSS
pixels. Desktop and 320-pixel screenshots were inspected. Keyboard Tab reached
the brand, search and navigation links; entering “templates” returned local
heading results. The accessibility tree identified the search control as
“Search headings…”. These checks do not establish comprehensive WCAG conformance.

Verification: 336 specification tests, 277 fixture expectations, 1,708 registered
rules and a 31-page site build passed. Budgets remain Core 600/600 rules,
Reuse 94/100, and Core reading path 19,983/20,000 words. The accepted prior
contract remains available at
[`f995555`](https://github.com/DeveloPassion/TypedMarkSpecification/tree/f9955555928ab69573d5e8beb376e9e98c3813e2).
Historical inventory reconstruction and the full validator-effort assessment
remain open in the [plan audit](plan-audit.md).
