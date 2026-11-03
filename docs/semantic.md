# Local semantic index

`SemanticIndex` ranks only the candidates supplied by its caller. The caller must apply pet, chat, person, and visibility filters before calling `rank`; the index does not broaden that scope.

```ts
const index = new SemanticIndex(store, { modelDir: localBgePath });
const ranked = await index.rank(petId, 'memory', query, visibleCandidates, 8);
const mode = index.status();
```

When the local BGE Small Chinese weights and `@huggingface/transformers` are available, embeddings are created lazily with Q8 inference and mean pooling. Remote model loading is disabled. The configured model directory is local-only; the index neither downloads weights nor calls a hosted API. Vectors are persisted in SQLite per `(pet, entity type, entity ID)` with a SHA-256 signature of the indexed text. A text edit invalidates and recomputes that entity's vector; pets and entity types never share rows.

If weights or the runtime package are missing, or local embedding fails, `rank` reports `matchMode: 'lexical'` and `status()` reports the reason. The fallback uses Latin token overlap and Chinese character n-grams and filters results below a relevance threshold. It does not describe lexical overlap as semantic similarity. Vector results also use a configurable minimum cosine similarity, defaulting to `0.25`.

`rank` returns matching candidate objects unchanged plus `score` and `matchMode`. It drops low-scoring candidates instead of returning arbitrary top results. Use `options.embed` only for local/injected embedding implementations and deterministic tests.
