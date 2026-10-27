## What and why

<!-- What does this pull request change, and why? Link the issue it closes, e.g. "Closes #12". -->

## Checklist

- [ ] `npm run typecheck` and `npm test` pass.
- [ ] Tests are added or updated for any change in behaviour.
- [ ] If the generated scripts change, I ran `npm run examples` and committed the regenerated `examples/*/script.js`.
- [ ] `CHANGELOG.md` has a line under `[Unreleased]`.
- [ ] If user-facing behaviour changed, `README.md` and `README.es.md` are updated.
- [ ] Claims about PTBuilder or Packet Tracer are checked against `docs/PTBUILDER_API.md`; anything unconfirmed stays tagged "sin verificar".
- [ ] Nothing in `src/` writes to stdout, and the generated script contains no `//`.
