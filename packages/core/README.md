# @mneme-ai/core

Core indexing, retrieval, and graph engine for [Mneme](https://github.com/patsa2561-art/mneme-ai).

```ts
import { git, indexer, store, retrieve } from "@mneme-ai/core";

const s = new store.MnemeStore("./.mneme/mneme.db");
const idx = new indexer.Indexer({ cwd: process.cwd(), store: s });
await idx.run();

const results = await retrieve.search("why does parseAmount use try/catch?", {
  store: s,
  topK: 5,
});
```

## What's in here

- `git/` — log/blame parser, repo metadata, GitHub + GitLab adapters
- `store/` — better-sqlite3 wrapper with FTS5 + BLOB embeddings
- `indexer/` — chunker + embedder driver
- `retrieve/` — hybrid search (BM25 + vector cosine fused via Reciprocal Rank Fusion) + reranker contracts
- `correlate/` — incident correlation contracts (Phase 3)
- `entities/` — symbol-level memory contracts (Phase 2)

See the [main README](https://github.com/patsa2561-art/mneme-ai#readme) for the full picture and [ARCHITECTURE.md](https://github.com/patsa2561-art/mneme-ai/blob/main/ARCHITECTURE.md) for the data-flow diagram.

## License

MIT.
