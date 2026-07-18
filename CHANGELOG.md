# Changelog

Changes to application functionality and externally observable runtime behavior
are documented in this file. Date entries in `YYYY-MM-DD` format and order them
in reverse chronological order. Add new entries at the top of the relevant
dated section; when multiple changes share a date, put the newest change first.

## Unreleased

Planned version: `1.0.0`. The package remains at `0.2.1` until the version
update is explicitly approved.

### 2026-07-18

- Fixed provider request header merging so case variants such as `Content-Type`
  and `content-type` produce one upstream field.
