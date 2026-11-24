-- ETA (S11, averageDurationMs): здачі заняття passed/rework від нової —
-- фільтр session_id і статус, сортування finished_at desc (spec лаби 4,
-- критерій 10). Поза транзакцією, без блокування запису (ADR-0044).
create index concurrently if not exists entries_eta
  on queue.entries (session_id, finished_at desc)
  where status in ('passed', 'rework');
