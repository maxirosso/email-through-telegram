-- Prisma creates its migration ledger in public. Prevent the Supabase Data API
-- roles from reading deployment metadata while retaining trusted server access.
ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
