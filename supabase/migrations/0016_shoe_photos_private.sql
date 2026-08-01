-- 0016_shoe_photos_private.sql — flip the shoe-photos bucket to private.
--
-- audit-code found `shoe-photos` public despite its storage.objects policies
-- already being owner-scoped (0009_shoes.sql) — a public bucket makes every
-- object URL guessable regardless of RLS. Mirrors 0011_activity_photos.sql:
-- flip `public` off; reads move to time-limited signed URLs
-- (src/app-lib/queries/shoes.ts), never a public/guessable URL.

update storage.buckets set public = false where id = 'shoe-photos';
