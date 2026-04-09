import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import Sidebar from './Sidebar';
import ChatInterface from './ChatInterface';
import UserManagement from './UserManagement';
import { LogOut, User, Building, Loader2, AlertCircle, Users, MessageSquare } from 'lucide-react';
import { motion } from 'motion/react';

export default function Dashboard({ session }: { session: any }) {
  const [company, setCompany] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'team'>('chat');

  const [retryCount, setRetryCount] = useState(0);
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    async function loadProfile() {
      // Don't show loading if we already have data (unless it's the very first load)
      if (!company) setLoading(true);
      setError(null);
      console.log('[Dashboard] Loading profile for user:', session.user.id, 'Attempt:', retryCount + 1);
      
      try {
        const { data: profile, error: profileError } = await supabase
          .from('users')
          .select('*, companies(*)')
          .eq('id', session.user.id)
          .single();

        if (!isMounted) return;

        if (profileError && profileError.code !== 'PGRST116') {
          console.error('[Dashboard] Profile load error:', profileError);
          setError(`Error loading profile: ${profileError.message}`);
        }

        if (profile) {
          setUserProfile(prev => {
            // Only update if data actually changed to prevent re-renders
            if (JSON.stringify(prev) === JSON.stringify(profile)) return prev;
            return profile;
          });
          
          const companyData = Array.isArray(profile.companies) ? profile.companies[0] : profile.companies;
          
          if (companyData) {
            setCompany(prev => {
              // Only update if company ID changed to prevent re-renders of children
              if (prev?.id === companyData.id) return prev;
              return companyData;
            });
            setLoading(false);
            return;
          }
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.error('[Dashboard] Unexpected error loading profile:', err);
        setError(`Unexpected error: ${err.message}`);
      }

      // If not found and we haven't retried too much, try again in 2 seconds
      if (retryCount < 3) {
        setTimeout(() => {
          if (isMounted) setRetryCount(prev => prev + 1);
        }, 2000);
      } else {
        setLoading(false);
      }
    }
    loadProfile();
    return () => { isMounted = false; };
  }, [session.user.id, retryCount]);

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;
    
    setCreatingCompany(true);
    setError(null);
    console.log('[Dashboard] Attempting to create company:', newCompanyName);
    
    try {
      // Use the backend API to bypass RLS issues on the frontend
      const response = await fetch('/api/setup/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ name: newCompanyName })
      });

      let result;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        const text = await response.text();
        console.error('[Dashboard] Non-JSON response from setup API:', text);
        throw new Error('Server returned an invalid response. Please try again.');
      }
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to create workspace');
      }

      console.log('[Dashboard] Workspace setup complete:', result.company);
      setCompany(result.company);
    } catch (err: any) {
      console.error('[Dashboard] Setup error:', err);
      setError(`Failed to create workspace: ${err.message || 'Unknown error'}`);
    } finally {
      setCreatingCompany(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black">
        <Loader2 className="w-12 h-12 animate-spin text-white mb-4" />
        <p className="text-zinc-500 animate-pulse uppercase tracking-widest text-xs font-bold">Initializing Workspace...</p>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-zinc-900 border border-zinc-800 p-8 text-center"
        >
          <div className="bg-white p-4 inline-block mb-6">
            <Building className="w-8 h-8 text-black" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2 uppercase tracking-tight">Setup Your Workspace</h2>
          <p className="text-zinc-500 mb-8">
            We couldn't find a company associated with your account. Let's create one now.
          </p>
          
          <form onSubmit={handleCreateCompany} className="space-y-4">
            <input
              type="text"
              required
              placeholder="Company Name"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              className="w-full px-4 py-3 bg-black border border-zinc-800 text-white focus:ring-1 focus:ring-white outline-none transition-all"
            />
            
            {error && (
              <div className="p-3 bg-red-900/20 text-red-400 text-xs rounded-none border border-red-900/50 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={creatingCompany}
              className="w-full bg-white text-black py-3 font-bold hover:bg-zinc-200 transition-all flex items-center justify-center gap-2"
            >
              {creatingCompany ? <Loader2 className="w-5 h-5 animate-spin" /> : 'CREATE COMPANY'}
            </button>
          </form>

          <button
            onClick={handleLogout}
            className="mt-6 text-zinc-500 hover:text-white text-sm font-bold uppercase tracking-widest transition-all"
          >
            OR LOGOUT
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-black overflow-hidden">
      {/* Sidebar - Only show for chat tab or on mobile if needed */}
      <Sidebar companyId={company?.id} userRole={userProfile?.role} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-16 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="bg-white p-2 rounded-none">
                <Building className="w-5 h-5 text-black" />
              </div>
              <h1 className="text-lg font-bold text-white truncate max-w-[150px] sm:max-w-md">
                {company?.name || 'CompanyMind'}
              </h1>
            </div>

            {/* Tabs */}
            <nav className="hidden sm:flex items-center gap-1">
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all border-b-2 ${
                  activeTab === 'chat' ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                Chat
              </button>
              {userProfile?.role === 'admin' && (
                <button
                  onClick={() => setActiveTab('team')}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all border-b-2 ${
                    activeTab === 'team' ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  Team
                </button>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-black rounded-none border border-zinc-800">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{userProfile?.role}</span>
              <span className="text-zinc-800">|</span>
              <span className="text-xs font-medium text-zinc-300">{session.user.email}</span>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded-none transition-all"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-hidden relative bg-black">
          {/* Keep both tabs mounted to prevent "auto load" / re-fetching when switching */}
          <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
            <ChatInterface session={session} companyId={company?.id} />
          </div>
          
          {userProfile?.role === 'admin' && (
            <div className={`h-full overflow-y-auto custom-scrollbar ${activeTab === 'team' ? 'block' : 'hidden'}`}>
              <UserManagement companyId={company?.id} currentUserId={session.user.id} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
