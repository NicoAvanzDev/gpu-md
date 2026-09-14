# Correctness and limits

The renderer handles headings, paragraphs, fenced and indented code, blockquotes, nested and loose lists, lazy continuations, emphasis, code spans, entity references, inline and reference links, autolinks, and images. It also includes tables, task items, and strikethrough extensions. Source HTML is escaped by default. Dangerous URL schemes are left as literal text.

**Passing the specification examples is not a guarantee for arbitrary Markdown.** The suite guided parser development; it is a regression suite, not an unseen test. The classifier can still misidentify new inputs, container nesting is capped at 12 levels, and extensions and URL restrictions can differ from strict CommonMark outside the suite. Confidence is an uncalibrated softmax score.

For the included model:

| Measurement                                                           |                  Result |
| --------------------------------------------------------------------- | ----------------------: |
| Synthetic held-out first-choice line agreement                        | 99.11% over 6,202 lines |
| Exact HTML matches, CommonMark corpus, source HTML escaped (default)  |      580 / 652 (88.96%) |
| Exact matches with markdown-it commonmark mode, source HTML disabled  |      637 / 652 (97.70%) |
| Exact HTML matches, CommonMark corpus, source HTML enabled explicitly |        652 / 652 (100%) |

The first score measures classification; the other scores evaluate complete rendered output byte for byte, without normalizing expected HTML. All 72 default-mode differences from the spec disappear when source HTML is enabled. Safe mode recognizes inline HTML as a literal unit; markdown-it with HTML disabled can interpret Markdown inside tag-shaped text, so their outputs can differ. The full per-section report is in [`evaluation.json`](../evaluation.json); detailed differences are written to `.training/evaluation.json`.

The corpus cache is pinned with a SHA-256 integrity check. `npm run test:conformance` writes detailed diagnostics only to `.training/`; `npm run evaluate` explicitly refreshes the checked-in summary. The corpus contains 652 examples and is used for development, not as evidence of generalization.
