import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { UserPlus, Trash2, Shield, User, Loader2, Mail, AlertCircle, CheckCircle2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function UserManagement({ companyId, currentUserId }: { companyId: string, currentUserId: string }) {
  const [users, setUsers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'user' | 'admin'>('user');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<{ id: string, email: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    fetchTeam();
  }, [companyId]);

  const fetchTeam = async () => {
    setLoading(true);
    setFetchError(null);

    try {
      // Fetch existing users
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: true });

      if (userError) throw userError;

      let allUsers = userData || [];

      // If current user is missing from the list (RLS delay or issue), try to fetch them specifically
      const exists = allUsers.some((u) => u.id === currentUserId);
      if (!exists && currentUserId) {
        const { data: me } = await supabase
          .from('users')
          .select('*')
          .eq('id', currentUserId)
          .single();

        if (me) allUsers = [...allUsers, me];
      }

      setUsers(allUsers);

      // Fetch pending invitations
      const { data: inviteData, error: inviteError } = await supabase
        .from('invitations')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: true });

      if (inviteError) throw inviteError;

      setInvitations(inviteData || []);
    } catch (err: any) {
      console.error('[UserManagement] Error fetching team:', err);
      setFetchError(err?.message || 'Failed to load team');
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!normalizedEmail) return;

    setIsInviting(true);
    setInviteError(null);
    setSuccess(null);

    try {
      // Check if user is trying to invite themselves
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (currentUser?.email?.toLowerCase() === normalizedEmail) {
        throw new Error('You cannot invite yourself to the workspace');
      }

      // Check if user already exists in company (local check only to avoid permission error)
      const alreadyInCompany = users.find(
        (u) => (u?.email || '').toLowerCase() === normalizedEmail
      );
      if (alreadyInCompany) {
        throw new Error('User is already a member of this workspace');
      }

      // Call the backend API to handle invitation and email sending
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) throw new Error('Not authenticated');

      const response = await fetch('/api/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: normalizedEmail,
          role: inviteRole,
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to send invitation';
        try {
          const errorData = await response.json();
          errorMessage = errorData?.error || errorMessage;
        } catch {
          // response not json
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      setSuccess(result?.message || `Invitation sent to ${normalizedEmail}`);
      setInviteEmail('');

      // Refresh team list in background
      await fetchTeam();
    } catch (err: any) {
      setInviteError(err?.message || 'Something went wrong while inviting user');
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemoveUser = async (userId: string, email: string) => {
    if (userId === currentUserId) {
      setActionError('You cannot remove yourself from the workspace.');
      return;
    }
    setConfirmDelete({ id: userId, email });
  };

  const executeRemoveUser = async () => {
    if (!confirmDelete) return;

    try {
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', confirmDelete.id)
        .eq('company_id', companyId);

      if (error) throw error;

      setConfirmDelete(null);
      await fetchTeam();
    } catch (err: any) {
      setActionError(`Error removing user: ${err?.message || 'Unknown error'}`);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    try {
      const { error } = await supabase
        .from('invitations')
        .delete()
        .eq('id', inviteId);

      if (error) throw error;

      await fetchTeam();
    } catch (err: any) {
      setActionError(`Error canceling invitation: ${err?.message || 'Unknown error'}`);
    }
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    try {
      const { error } = await supabase
        .from('users')
        .update({ role: newRole })
        .eq('id', userId)
        .eq('company_id', companyId);

      if (error) throw error;

      await fetchTeam();
    } catch (err: any) {
      setActionError(`Error updating role: ${err?.message || 'Unknown error'}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-700" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      {/* Invite Section */}
      <section className="bg-zinc-900 border border-zinc-800 p-6">
        <div className="flex items-center gap-2 mb-6">
          <UserPlus className="w-5 h-5 text-white" />
          <h2 className="text-lg font-bold text-white uppercase tracking-tight">Invite Team Member</h2>
        </div>

        {/* Custom bug notice message */}
        <p className="text-yellow-400 text-xs mb-4 bg-yellow-900/20 border border-yellow-900/40 px-3 py-2">
          Come in soon here is some bug in here
        </p>

        <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="email"
              required
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-black border border-zinc-800 text-white focus:ring-1 focus:ring-white outline-none transition-all"
            />
          </div>

          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as any)}
            className="px-4 py-2.5 bg-black border border-zinc-800 text-white focus:ring-1 focus:ring-white outline-none transition-all"
          >
            <option value="user">User (Chat Only)</option>
            <option value="admin">Admin (Full Access)</option>
          </select>

          <button
            type="submit"
            disabled={isInviting}
            className="bg-white text-black px-6 py-2.5 font-bold hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isInviting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'SEND INVITE'}
          </button>
        </form>

        <AnimatePresence mode="wait">
          {fetchError && (
            <motion.div
              key="error-fetch"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 p-3 bg-red-900/20 border border-red-900/50 text-red-400 text-xs flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4" />
              {fetchError}
            </motion.div>
          )}

          {inviteError && (
            <motion.div
              key="error-invite"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 p-3 bg-red-900/20 border border-red-900/50 text-red-400 text-xs flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4" />
              {inviteError}
            </motion.div>
          )}

          {actionError && (
            <motion.div
              key="error-action"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 p-3 bg-red-900/20 border border-red-900/50 text-red-400 text-xs flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {actionError}
              </div>
              <button onClick={() => setActionError(null)} className="text-zinc-400 hover:text-white">
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          )}

          {success && (
            <motion.div
              key="success-invite"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 p-3 bg-green-900/20 border border-green-900/50 text-green-400 text-xs flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              {success}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Team List */}
      <section className="space-y-4">
        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Active Workspace Members</h3>
        <div className="grid gap-2">
          {users.map((user) => (
            <div key={user.id} className="bg-zinc-900 border border-zinc-800 p-4 flex items-center justify-between group">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-zinc-800 flex items-center justify-center text-zinc-400">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white flex items-center gap-2">
                    {user.email}
                    {user.id === currentUserId && (
                      <span className="text-[10px] bg-white text-black px-1.5 py-0.5 font-black uppercase">You</span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-500 uppercase tracking-wider">{user.role}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {user.id !== currentUserId && (
                  <>
                    <select
                      value={user.role}
                      onChange={(e) => handleChangeRole(user.id, e.target.value)}
                      className="bg-black border border-zinc-800 text-xs text-zinc-400 px-2 py-1 focus:ring-1 focus:ring-white outline-none"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      onClick={() => handleRemoveUser(user.id, user.email)}
                      className="p-2 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 transition-all"
                      title="Remove from workspace"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                {user.id === currentUserId && (
                  <Shield className="w-4 h-4 text-zinc-700 mr-2" />
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-800 p-8 max-w-sm w-full text-center space-y-6"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-white">Remove User?</h3>
                <p className="text-sm text-zinc-400">
                  Are you sure you want to remove <span className="text-white font-bold">{confirmDelete.email}</span> from the workspace? This action cannot be undone.
                </p>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 px-4 py-3 border border-zinc-800 text-white font-bold hover:bg-zinc-800 transition-all"
                >
                  CANCEL
                </button>
                <button
                  onClick={executeRemoveUser}
                  className="flex-1 px-4 py-3 bg-red-600 text-white font-bold hover:bg-red-700 transition-all"
                >
                  REMOVE
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Pending Invitations</h3>
          <div className="grid gap-2">
            {invitations.map((invite) => (
              <div key={invite.id} className="bg-zinc-900/50 border border-zinc-800/50 p-4 flex items-center justify-between border-dashed">
                <div className="flex items-center gap-4 opacity-60">
                  <div className="w-10 h-10 bg-zinc-800/50 flex items-center justify-center text-zinc-500">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-zinc-300">{invite.email}</p>
                    <p className="text-xs text-zinc-600 uppercase tracking-wider">Invited as {invite.role}</p>
                  </div>
                </div>

                <button
                  onClick={() => handleCancelInvite(invite.id)}
                  className="text-xs font-bold text-zinc-600 hover:text-white uppercase tracking-widest transition-all"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}