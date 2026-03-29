CREATE POLICY "Students can insert own attendance"
ON public.attendance FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = student_id);