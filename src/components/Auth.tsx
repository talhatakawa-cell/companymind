import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { motion } from 'motion/react';
import { LogIn, UserPlus, Building2, KeyRound } from 'lucide-react';

export default function Auth() {
  const [mode, setMode] = useState<'login' | 'signup' | 'set-password'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    // Check if we are in a password reset or invite flow
    const hash = window.location.hash;
    if (hash && (hash.includes('type=recovery') || hash.includes('type=invite') || hash.includes('access_token='))) {
      setMode('set-password');
    }
  }, []);

  const handleResendEmail = async () => {
    if (!email) {
      setError('Please enter your email address first.');
      return;
    }
    setResending(true);
    setError(null);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: window.location.origin,
        }
      });
      if (error) throw error;
      setSuccess('Confirmation email resent! Please check your inbox.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess('Password set successfully! You can now use the workspace.');
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'set-password') return handleSetPassword(e);

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (error.message.includes('Email not confirmed')) {
            throw new Error('Email not confirmed. Please check your inbox (and spam) for the confirmation link.');
          }
          throw error;
        }
      } else {
        // 1. Sign up user
        const { data: { user }, error: signUpError } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            emailRedirectTo: window.location.origin,
          }
        });
        if (signUpError) throw signUpError;
        if (!user) throw new Error('Sign up failed');

        // 2. Check for invitation
        const { data: invite } = await supabase
          .from('invitations')
          .select('*')
          .eq('email', email)
          .single();

        if (invite) {
          console.log('[Auth] Found invitation for:', email);
          // The handle_new_user trigger in Postgres will automatically 
          // create the user profile and link it to the company.
          // We just need to wait a moment or redirect.
        } else {
          // 3. Create company via API (only if no invitation)
          console.log('[Auth] No invitation found, creating new company via API:', companyName);
          if (!companyName) throw new Error('Company name is required for new accounts');
          
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) throw new Error('Not authenticated');

          const response = await fetch('/api/setup/workspace', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ name: companyName })
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to setup workspace');
          }
        }

        setSuccess('Account created successfully! Please check your email to confirm your account.');
        setMode('login');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black p-4">
      <motion.div 
        initial={{ opacity: 0, y: 0 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-none shadow-2xl p-8"
      >
        <div className="flex justify-center mb-8">
          <div className="bg-white p-3 rounded-none">
            <Building2 className="w-8 h-8 text-black" />
          </div>
        </div>
        <h2 className="text-3xl font-bold text-center text-white mb-2">
          {mode === 'login' ? 'Welcome Back' : mode === 'signup' ? 'Create Account' : 'Set Your Password'}
        </h2>
        <p className="text-center text-zinc-500 mb-8">
          {mode === 'login' 
            ? 'Sign in to your company workspace' 
            : mode === 'signup' 
              ? 'Start your private AI knowledge base'
              : 'Complete your invitation by setting a password'}
        </p>

        <form onSubmit={handleAuth} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">Company Name</label>
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full px-4 py-2 bg-black border border-zinc-700 text-white rounded-none focus:ring-1 focus:ring-white outline-none transition-all"
                placeholder="Acme Corp"
              />
            </div>
          )}
          
          {mode !== 'set-password' && (
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 bg-black border border-zinc-700 text-white rounded-none focus:ring-1 focus:ring-white outline-none transition-all"
                placeholder="you@company.com"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">
              {mode === 'set-password' ? 'New Password' : 'Password'}
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 bg-black border border-zinc-700 text-white rounded-none focus:ring-1 focus:ring-white outline-none transition-all"
              placeholder="••••••••"
            />
          </div>

          {mode === 'set-password' && (
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">Confirm New Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2 bg-black border border-zinc-700 text-white rounded-none focus:ring-1 focus:ring-white outline-none transition-all"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-900/20 text-red-400 text-sm rounded-none border border-red-900/50">
              {error}
              {error.includes('Email not confirmed') && (
                <button
                  type="button"
                  onClick={handleResendEmail}
                  disabled={resending}
                  className="block mt-2 underline hover:text-white transition-colors"
                >
                  {resending ? 'Resending...' : 'Resend confirmation email'}
                </button>
              )}
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-900/20 text-green-400 text-sm rounded-none border border-green-900/50">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-black py-3 rounded-none font-bold hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-black"></div>
            ) : mode === 'login' ? (
              <>
                <LogIn className="w-5 h-5" /> Sign In
              </>
            ) : mode === 'signup' ? (
              <>
                <UserPlus className="w-5 h-5" /> Sign Up
              </>
            ) : (
              <>
                <KeyRound className="w-5 h-5" /> Set Password
              </>
            )}
          </button>
        </form>

        {mode !== 'set-password' && (
          <div className="mt-6 text-center">
            <button
              onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
              className="text-zinc-400 hover:text-white text-sm font-medium transition-colors"
            >
              {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
