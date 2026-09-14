# Security boundaries

Source HTML is escaped by default. `allowHtml: true` deliberately passes source HTML through without sanitization; it is suitable only for trusted content or a separate sanitization step before DOM insertion. The renderer is not an HTML sanitizer.

Generated link and image attributes are escaped. Destinations containing control characters, protocol-relative URLs, or `javascript:`, `vbscript:`, `file:`, and `data:` schemes are rejected. Other URL schemes may be emitted; embedding applications should enforce any stricter navigation policy they need. Images can make network requests when the rendered HTML enters the DOM.

Default character and line limits are enforced before line/feature allocation. Container recursion is bounded, and inline rendering uses an explicit stack. These measures do not promise a fixed time or memory budget for every adversarial input. Use a terminable worker and application-level limits for untrusted workloads. The playground coalesces edits and terminates a stalled worker after 30 seconds.

The library has no inference service, credentials, or telemetry. The playground self-hosts its fonts. Development servers bind to loopback by default; deploy `dist/` through an HTTPS static host instead of exposing the development server.

Before publishing, configure a private vulnerability reporting channel on the repository hosting service and document it here. No maintainer contact or repository URL has been supplied in this checkout. Avoid posting exploitable security reports in public issues before the maintainer has a chance to assess them.
