-- TASK-002 · личный канал user:<id>: через него ждущий одобрения узнаёт, что его приняли
-- (на канал кампании он ещё не допущен). Чужой личный канал недоступен.
create policy user_channel_read on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and (select realtime.topic()) = 'user:' || (select auth.uid())::text);
create policy user_channel_write on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and (select realtime.topic()) = 'user:' || (select auth.uid())::text);
