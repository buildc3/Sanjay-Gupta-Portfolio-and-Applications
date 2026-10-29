-- Private bucket for partner / business-login documents.
-- Only the Netlify function (service role key) reads and writes it, so no public access and no RLS policies are added.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'partner-documents', 'partner-documents', false, 5242880,
  array['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
