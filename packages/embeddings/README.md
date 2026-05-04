# @mneme-ai/embeddings

Embedding providers for [Mneme](https://github.com/patsa2561-art/mneme-ai). Three implementations of the same `EmbeddingProvider` interface.

```ts
import { resolveEmbedder } from "@mneme-ai/embeddings";

// Auto: try Ollama → OpenAI → hash fallback
const embedder = await resolveEmbedder({ provider: "auto" });
const [vec] = await embedder.embed(["fix Stripe webhook crash on bigint"]);
```

## Providers

| Provider | Quality | Setup | Cost |
|---|---|---|---|
| `OllamaEmbedder` | ★★★★ | `ollama pull nomic-embed-text` | $0 |
| `OpenAIEmbedder` | ★★★★★ | `OPENAI_API_KEY=…` | ~$0.02/M tokens |
| `HashEmbedder` | ★★ | nothing | $0 |

The `HashEmbedder` is a deterministic FNV-1a hashing-trick fallback. Useful for tests, CI, and "I want to try mneme without installing anything." Not a substitute for a real embedder in production.

## License

MIT.
