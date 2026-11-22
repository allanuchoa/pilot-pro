-- Schema da ferramenta Pilot Pro (prefixo ppr_)
-- Seguro para re-execucao. Nao cria nem altera policies do Registry global.

CREATE TABLE IF NOT EXISTS public.ppr_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  mission_type text NOT NULL CHECK (mission_type IN ('grid', 'double_grid', 'corridor')),
  drone_key text NOT NULL,
  area_geojson jsonb NOT NULL,
  takeoff_point jsonb,
  flight_params jsonb NOT NULL,
  summary_metrics jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ppr_drone_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  sensor_width_mm numeric(6,2) NOT NULL,
  sensor_height_mm numeric(6,2) NOT NULL,
  focal_length_mm numeric(6,2) NOT NULL,
  image_width_px integer NOT NULL,
  image_height_px integer NOT NULL,
  max_flight_time_min numeric(5,1) NOT NULL,
  max_safe_speed_ms numeric(4,1) NOT NULL,
  has_mechanical_shutter boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppr_missions_user_updated
  ON public.ppr_missions (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ppr_drone_profiles_user_name
  ON public.ppr_drone_profiles (user_id, name);

CREATE OR REPLACE FUNCTION public.ppr_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ppr_missions_updated_at ON public.ppr_missions;
CREATE TRIGGER trg_ppr_missions_updated_at
  BEFORE UPDATE ON public.ppr_missions
  FOR EACH ROW
  EXECUTE FUNCTION public.ppr_set_updated_at();

DROP TRIGGER IF EXISTS trg_ppr_drone_profiles_updated_at ON public.ppr_drone_profiles;
CREATE TRIGGER trg_ppr_drone_profiles_updated_at
  BEFORE UPDATE ON public.ppr_drone_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.ppr_set_updated_at();

ALTER TABLE public.ppr_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppr_drone_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ppr_missions_owner_access ON public.ppr_missions;
CREATE POLICY ppr_missions_owner_access
  ON public.ppr_missions
  FOR ALL
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.user_applications ua
      JOIN public.applications a ON a.id = ua.application_id
      WHERE ua.user_id = auth.uid()
        AND a.slug = 'pilot-pro'
        AND a.is_active = true
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.user_applications ua
      JOIN public.applications a ON a.id = ua.application_id
      WHERE ua.user_id = auth.uid()
        AND a.slug = 'pilot-pro'
        AND a.is_active = true
    )
  );

DROP POLICY IF EXISTS ppr_drone_profiles_owner_access ON public.ppr_drone_profiles;
CREATE POLICY ppr_drone_profiles_owner_access
  ON public.ppr_drone_profiles
  FOR ALL
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.user_applications ua
      JOIN public.applications a ON a.id = ua.application_id
      WHERE ua.user_id = auth.uid()
        AND a.slug = 'pilot-pro'
        AND a.is_active = true
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.user_applications ua
      JOIN public.applications a ON a.id = ua.application_id
      WHERE ua.user_id = auth.uid()
        AND a.slug = 'pilot-pro'
        AND a.is_active = true
    )
  );
