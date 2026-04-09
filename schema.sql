-- ===============================================================
-- 1. EXTENSIONS & TABLES
-- ===============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- Companies Table
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users Table (Extends Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Documents Table
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  status TEXT DEFAULT 'processing',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Document Chunks Table (with Vector Support)
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding VECTOR(3072),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chats Table
CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT,
  sources JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Invitations Table
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(company_id, email)
);

-- ===============================================================
-- 2. SECURITY FUNCTIONS (The Permanent Fix)
-- ===============================================================
-- These functions bypass RLS recursion by using SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.get_auth_company_id()
RETURNS UUID AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS TEXT AS $$
  SELECT role FROM public.users WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- ===============================================================
-- 3. RLS POLICIES
-- ===============================================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Cleanup old policies to avoid duplicates
DO $$ 
DECLARE 
  pol RECORD;
BEGIN
  FOR pol IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- Companies: Public view for signup, but restricted updates
CREATE POLICY "companies_view_policy" ON companies FOR SELECT USING (true);
CREATE POLICY "companies_insert_policy" ON companies FOR INSERT WITH CHECK (true);

-- Users: See yourself and your team
CREATE POLICY "users_view_policy" ON users FOR SELECT 
USING (id = auth.uid() OR company_id = public.get_auth_company_id());

CREATE POLICY "users_admin_policy" ON users FOR ALL 
USING (public.get_auth_role() = 'admin' AND company_id = public.get_auth_company_id());

-- Documents: Company-wide access
CREATE POLICY "documents_view_policy" ON documents FOR SELECT 
USING (company_id = public.get_auth_company_id());

CREATE POLICY "documents_admin_policy" ON documents FOR ALL 
USING (public.get_auth_role() = 'admin' AND company_id = public.get_auth_company_id());

-- Document Chunks: Company-wide access
CREATE POLICY "chunks_view_policy" ON document_chunks FOR SELECT 
USING (company_id = public.get_auth_company_id());

CREATE POLICY "chunks_admin_policy" ON document_chunks FOR ALL 
USING (public.get_auth_role() = 'admin' AND company_id = public.get_auth_company_id());

-- Chats: Private to user
CREATE POLICY "chats_view_policy" ON chats FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "chats_insert_policy" ON chats FOR INSERT WITH CHECK (user_id = auth.uid());

-- Invitations: Admins can manage
CREATE POLICY "invitations_admin_policy" ON invitations FOR ALL 
USING (public.get_auth_role() = 'admin' AND company_id = public.get_auth_company_id());

CREATE POLICY "invitations_view_own" ON invitations FOR SELECT 
USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- ===============================================================
-- 4. AUTOMATION TRIGGERS
-- ===============================================================
-- Automatically create/update profile when auth.users changes
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  target_company_id UUID;
  target_role TEXT;
BEGIN
  -- 1. Check for invitation metadata
  target_company_id := (new.raw_user_meta_data->>'invited_to_company')::UUID;
  target_role := new.raw_user_meta_data->>'role';

  -- 2. Fallback to invitations table
  IF target_company_id IS NULL THEN
    SELECT company_id, role INTO target_company_id, target_role 
    FROM public.invitations 
    WHERE email = new.email 
    LIMIT 1;
  END IF;

  -- 3. Create profile
  IF target_company_id IS NOT NULL THEN
    INSERT INTO public.users (id, company_id, email, role)
    VALUES (new.id, target_company_id, new.email, COALESCE(target_role, 'user'))
    ON CONFLICT (id) DO UPDATE 
    SET company_id = EXCLUDED.company_id, 
        role = EXCLUDED.role;
        
    DELETE FROM public.invitations WHERE email = new.email;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===============================================================
-- 5. MASTER PERMISSIONS & BOOTSTRAP (Fixes "Permission Denied")
-- ===============================================================
-- 1. Schema Usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2. Table Permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- 3. Explicit Table Grants (Double-check for Users table)
GRANT ALL ON public.users TO authenticated;
GRANT ALL ON public.companies TO authenticated;
GRANT ALL ON public.invitations TO authenticated;

-- Ensure existing users are admins for safety during setup
UPDATE public.users SET role = 'admin';

-- Similarity Search Function
CREATE OR REPLACE FUNCTION match_document_chunks (
  query_embedding VECTOR(3072),
  match_threshold FLOAT,
  match_count INT,
  p_company_id UUID
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  content TEXT,
  similarity FLOAT,
  document_name TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) AS similarity,
    d.name as document_name
  FROM document_chunks dc
  JOIN documents d ON d.id = dc.document_id
  WHERE dc.company_id = p_company_id
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
