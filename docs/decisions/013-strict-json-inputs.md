# Strict JSON file inputs

Status: accepted on 2026-09-15 (Europe/Brussels).

## Problem

Five runtime JSON read sites used replacement decoding. A malformed byte in a CLI
query predicate could match a valid stored U+FFFD value. Corrupt expected-report
messages or query-case rows could likewise produce passing vector evidence after
repair. Invalid schema enum strings could be registered with changed values.
The source files stayed unchanged, but their interpreted meaning did not.

## Decision

A small pure `decodeUtf8(bytes, source)` helper uses fatal UTF-8 decoding and keeps
the BOM in the decoded text. Callers retain their existing JSON.parse calls, so
JSON syntax errors (including existing leading-BOM rejection) remain SyntaxError.
Malformed encoding throws an operational TypeError identifying the input without
including its contents. Filesystem reads remain outside the decoder and keep their
normal failures.

Migration readiness retains its existing outer catch: an unavailable loader
produces a generic `manual_resolution_required` snapshot result, not a thrown
loader error or a `ready` decision. This deliberate adapter behavior predates
the decoder. The lower-level loader still identifies the corrupted input; this
change does not expand the readiness API's error-detail contract.

The helper is used by the query CLI, expected-report loader, query-case loader,
vector-context loader and schema registry. Both synchronous and asynchronous reads
pass bytes to it before any JSON interpretation. It does not read files, mutate
buffers, normalize strings, remove BOMs or turn decoding failures into QueryError.
The already-decoded in-memory query API and JSON marker parsing in valid Markdown
are unchanged; Markdown has its own fatal byte boundary.

## Verification and scope

Twenty-six regression/control cases exercise all five loaders, malformed byte
forms, false-positive query/evidence scenarios, input-name diagnostics and source
preservation. They retain valid U+FFFD/Unicode data, existing syntax and shape
failures, and the in-memory query contract. No JSON artifact shape or validation
capability changed. This is not a new JSON BOM policy or a general input-size limit.
The readiness case first proves a valid strict version no-op is ready, then
corrupts a schema and verifies that it requires manual resolution without writes.

Sources:

- [TextDecoder fatal and ignoreBOM options](https://nodejs.org/api/util.html#new-textdecoderencoding-options)
- [RFC 8259 character encoding](https://www.rfc-editor.org/rfc/rfc8259#section-8.1)
- [TypedMark runner boundary](https://github.com/DeveloPassion/TypedMarkSpecification/blob/main/schema/docs/conformance-runner.md)
