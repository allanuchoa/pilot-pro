-- Script de onboarding do Pilot Pro no Registry global do Allan Workbench
-- Seguro para re-execucao. Nunca cria ou remove policies em applications, user_applications ou profiles.

INSERT INTO public.applications (
  slug,
  name,
  url,
  icon,
  category,
  is_active,
  status
)
VALUES (
  'pilot-pro',
  'Pilot Pro',
  'https://allanuchoa.github.io/pilot-pro/',
  'map',
  'Engineering',
  true,
  'active'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  url = EXCLUDED.url,
  icon = EXCLUDED.icon,
  category = EXCLUDED.category,
  is_active = EXCLUDED.is_active,
  status = EXCLUDED.status;

-- Substitua o placeholder abaixo pelo UUID real do usuario em public.profiles antes de executar.
INSERT INTO public.user_applications (user_id, application_id)
SELECT
  '00000000-0000-0000-0000-000000000000'::uuid,
  a.id
FROM public.applications a
WHERE a.slug = 'pilot-pro'
ON CONFLICT DO NOTHING;
