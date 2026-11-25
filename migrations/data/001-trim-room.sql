-- Пробіли по краях room (spec лаби 4, критерій 9). Один пакет — до 100
-- рядків; фоновий ранер повторює оператор, доки він змінює рядки, кожен
-- пакет — окрема коротка транзакція (ADR-0044).
update sessions.sessions set room = btrim(room)
where id in (
  select id from sessions.sessions where room <> btrim(room) limit 100
);
