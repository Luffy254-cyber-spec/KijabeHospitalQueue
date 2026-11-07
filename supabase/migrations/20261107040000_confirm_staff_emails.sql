-- Unblock common staff whose Firebase continueUrl failed on LAN (email never marked confirmed).
-- Login still requires password + 6-digit code; pending profiles still need superadmin approval.
update auth.users u
set email_confirmed_at = coalesce(u.email_confirmed_at, now())
where u.email_confirmed_at is null
  and exists (
    select 1 from public.staff_profiles sp where sp.user_id = u.id
  );
