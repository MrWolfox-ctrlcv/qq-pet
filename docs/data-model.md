# Data model

SQLite is the source of truth. Every user-owned row is scoped by `pet_id`; media blobs are content-addressed globally by SHA-256 while asset records remain per-pet, per-purpose and per-visibility. Images are decoded by Sharp before import and constrained to 25 MiB. The media file is written before its row is committed, so an interrupted import can leave only an unreferenced file, never a row pointing at a partial file.

Pet, asset, memory and person updates use integer versions. A stale version throws `StoreError` with status 409. Updates retain the prior JSON snapshot in `revisions`, and append an audit event. Hiding is reversible. Person fields have independent lock names: actor `model` may update other fields but locked fields retain their stored value. Memory terms are rebuilt transactionally with each content update and are lexical retrieval only, not embeddings or semantic search.

Messages are occurrences, unique by `(pet_id, chat_id, source id)`, and have monotonic per-chat sequences. Replayed source events return the existing row. Identical image bytes may share a blob, but messages and asset visibility remain distinct. `backup()` uses SQLite's online backup API and copies all referenced media into the backup's `media` folder.

Schema migration version 1 creates the initial schema idempotently. `scripts/import-legacy.ts` opens legacy `agent.db` read-only, imports an allowlisted non-secret pet configuration subset plus memories, profiles and sticker rows where files can be recovered. It never writes to the source. Repeated runs skip existing matching pet/profile IDs, memory text+kind, and sticker hashes. Import output is a JSON report on stdout.
