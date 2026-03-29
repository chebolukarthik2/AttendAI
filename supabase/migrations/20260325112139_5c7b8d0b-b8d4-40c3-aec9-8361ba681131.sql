ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT false;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS room_name text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS classroom_lat double precision;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS classroom_lng double precision;