-- TASK-002 · советник безопасности: триггерные функции не вызываются через API.
-- Триггеры работают и без права EXECUTE у ролей API. Помощники прав (is_member и др.) остаются
-- доступны вошедшим: их вызывают политики RLS от имени пользователя, раскрывают они только его же членство.
revoke execute on function
  public.profile_from_auth(), public.campaign_owner_member(), public.touch_updated_at(),
  public.guard_member_update(), public.guard_character(), public.guard_scene_update(),
  public.guard_token(), public.guard_drawing(), public.guard_save_request(), public.guard_combat()
from public, anon, authenticated;
revoke execute on function public.add_explored(text, text[]), public.claim_character(text, text), public.join_campaign(text) from anon;
