# @mneme-ai/web

Phase 4 — D3 temporal graph viewer for [Mneme](https://github.com/patsa2561-art/mneme-ai).

> Status: placeholder UI + zero-dep static server. The full D3 force-layout implementation is on the roadmap.

## Run

```bash
cd packages/web
node server.js
# → http://localhost:4711
```

## Roadmap

- [ ] `/api/graph?at=<iso>` — graph at a point in git time
- [ ] D3 force-layout with commit/incident/entity nodes
- [ ] Timeline scrubber (animate graph through history)
- [ ] Incident → ancestry walk (highlight suspect commits)
- [ ] Cluster collapsing for repos with >10 k nodes

## License

MIT.
