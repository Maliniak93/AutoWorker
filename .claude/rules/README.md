# Path-scoped rules

Put one Markdown file per area of the codebase here (for example `api.md`, `web.md`, `testing.md`). Claude Code
loads a rule file automatically when it touches a file matching the `paths:` globs in the file's frontmatter, so the
rule costs nothing in sessions that never touch that area.

- Frontmatter: a `paths:` list of globs. A file without `paths:` loads in every session, so keep those out of this folder; put global rules in `CLAUDE.md`.
- Body: the conventions an agent cannot infer from the code — what to copy, what is forbidden, how the area is tested. One home per rule; point to it from elsewhere instead of repeating it.
- Keep each file short. A convention that changes is updated here in the same change as the code (the implementer's and reviewer's Definition of done check it).
- `example.md` is a commented template: copy it, rename it, fill it in, and delete the example when you have a real rule.
