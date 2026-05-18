CREATE TABLE public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invites_token ON public.invites(token);
CREATE INDEX idx_invites_email ON public.invites(email);

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Administrators can view invites"
  ON public.invites FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Administrators can insert invites"
  ON public.invites FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Administrators can delete invites"
  ON public.invites FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Administrators can update invites"
  ON public.invites FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'administrator'));