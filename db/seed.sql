insert into workspaces (id, name, slug)
values (gen_random_uuid(), 'OpenClaw', 'openclaw')
on conflict (slug) do update set name = excluded.name, updated_at = now();

insert into profiles (workspace_id, email, name, role)
select id, null, 'OpenClaw User', 'owner'
from workspaces
where slug = 'openclaw'
on conflict do nothing;

insert into app_settings (id, gateway_token, setup_completed)
values (1, '', false)
on conflict (id) do nothing;

-- Intentionally no default boards/columns in seed.
-- Boards should be created explicitly via UI/API to avoid duplicate auto-created boards.
