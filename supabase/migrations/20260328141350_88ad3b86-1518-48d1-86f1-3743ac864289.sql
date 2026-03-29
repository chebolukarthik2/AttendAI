
-- Add voice_sample_url column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS voice_sample_url text;

-- Add azure_speaker_profile_id column (used by verify-voice edge function)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS azure_speaker_profile_id text;

-- Create voice-samples storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-samples', 'voice-samples', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: authenticated users can upload voice samples
CREATE POLICY "Authenticated users can upload voice samples"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'voice-samples');

-- Authenticated users can read voice samples
CREATE POLICY "Anyone can read voice samples"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'voice-samples');

-- Users can update their own voice samples
CREATE POLICY "Authenticated users can update voice samples"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'voice-samples');

-- Users can delete their own voice samples
CREATE POLICY "Authenticated users can delete voice samples"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'voice-samples');
