-- 1. Create special functions that bypass the "Security Loop"
-- These are permanent and work for ALL users/emails
CREATE OR REPLACE FUNCTION public.get_auth_company_id()
RETURNS UUID AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS TEXT AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- 2. Drop all old, broken policies to start fresh
DROP POLICY IF EXISTS "Allow all select on users" ON users;
DROP POLICY IF EXISTS "Allow all insert on users" ON users;
DROP POLICY IF EXISTS "Allow all update on users" ON users;
DROP POLICY IF EXISTS "Users can delete users in their company" ON users;
DROP POLICY IF EXISTS "Admins can manage invitations" ON invitations;
DROP POLICY IF EXISTS "Admins can view invitations" ON invitations;
DROP POLICY IF EXISTS "Anyone can view their own invitation" ON invitations;

-- 3. Apply the Permanent Fix to the USERS table
-- This allows users to see their teammates without recursion
CREATE POLICY "Users can view members of their own company" 
ON public.users FOR SELECT 
USING (company_id = public.get_auth_company_id());

CREATE POLICY "Admins can manage users in their company" 
ON public.users FOR ALL 
USING (public.get_auth_role() = 'admin' AND company_id = public.get_auth_company_id());

-- 4. Apply the Permanent Fix to the INVITATIONS table
CREATE POLICY "Admins can manage invitations" 
ON public.invitations FOR ALL 
USING (public.get_auth_role() = 'admin' AND company_id = public.get_auth_company_id());

CREATE POLICY "Users can view invitations for their company" 
ON public.invitations FOR SELECT 
USING (company_id = public.get_auth_company_id());

-- 5. Ensure the current user is an admin so they can actually use the app
-- Replace 'bno43401@gmail.com' with the actual user email if different
UPDATE public.users 
SET role = 'admin' 
WHERE email = 'bno43401@gmail.com';

-- 6. Grant necessary permissions to the authenticated role
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
