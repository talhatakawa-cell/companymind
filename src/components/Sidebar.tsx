import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { FileText, Trash2, Plus, Loader2, File, CheckCircle2, AlertCircle } from 'lucide-react';
import DocumentUpload from './DocumentUpload';
import { motion, AnimatePresence } from 'motion/react';

export default function Sidebar({ companyId, userRole }: { companyId: string, userRole?: string }) {
  const [documents, setDocuments] = useState<any[]>([]);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const isAdmin = userRole === 'admin';

  useEffect(() => {
    if (!companyId) {
      console.warn('[Sidebar] No companyId provided, skipping fetch');
      setLoading(false);
      return;
    }

    const fetchDocuments = async () => {
      console.log('[Sidebar] Fetching documents for company:', companyId);
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Sidebar] Fetch documents error:', error);
      }
      if (data) {
        console.log(`[Sidebar] Fetched ${data.length} documents`);
        setDocuments(data);
      }
      setLoading(false);
    };

    fetchDocuments();

    // Real-time subscription
    console.log('[Sidebar] Subscribing to real-time documents for company:', companyId);
    const channel = supabase
      .channel(`documents-${companyId}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'documents', 
        filter: `company_id=eq.${companyId}` 
      }, (payload) => {
        console.log('[Sidebar] Real-time document change:', payload.eventType, payload.new || payload.old);
        if (payload.eventType === 'INSERT') {
          setDocuments(prev => {
            const exists = prev.some(d => d.id === payload.new.id);
            if (exists) return prev;
            return [payload.new, ...prev];
          });
        } else if (payload.eventType === 'UPDATE') {
          setDocuments(prev => prev.map(doc => doc.id === payload.new.id ? payload.new : doc));
        } else if (payload.eventType === 'DELETE') {
          setDocuments(prev => prev.filter(doc => doc.id !== payload.old.id));
        }
      })
      .subscribe((status) => {
        console.log(`[Sidebar] Subscription status: ${status}`);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId]);

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"? This will remove all associated data.`)) {
      return;
    }
    
    try {
      setIsDeleting(id);
      console.log(`[Sidebar] Deleting document: ${id} (${name}) for company: ${companyId}`);
      
      // Use { count: 'exact' } to verify if a row was actually deleted
      const { error, count } = await supabase
        .from('documents')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('company_id', companyId);
        
      if (error) {
        console.error('[Sidebar] Delete error:', error);
        throw error;
      }
      
      console.log(`[Sidebar] Delete result: count=${count}`);
      
      if (count === 0) {
        console.warn('[Sidebar] No rows were deleted. This might be a permission issue (RLS).');
        alert('Could not delete document. You may not have permission to delete this file.');
        return;
      }
      
      console.log(`[Sidebar] Successfully deleted: ${id}`);
      // Optimistic update
      setDocuments(prev => prev.filter(doc => doc.id !== id));
    } catch (error: any) {
      console.error('[Sidebar] Delete operation failed:', error);
      alert(`Failed to delete document: ${error.message || 'Unknown error'}`);
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <div className="w-72 bg-black border-r border-zinc-800 text-white flex flex-col shrink-0">
      {/* Sidebar Header */}
      <div className="p-6 border-b border-zinc-800">
        <div className="flex items-center gap-2 mb-6">
          <div className="bg-white p-1.5 rounded-none">
            <FileText className="w-5 h-5 text-black" />
          </div>
          <span className="text-xl font-bold tracking-tight">CompanyMind</span>
        </div>

        {isAdmin && (
          <button
            onClick={() => setIsUploadOpen(true)}
            className="w-full bg-white hover:bg-zinc-200 text-black py-3 rounded-none font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-white/5"
          >
            <Plus className="w-5 h-5" />
            Upload Document
          </button>
        )}
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
        <h3 className="px-2 text-xs font-semibold text-zinc-600 uppercase tracking-wider mb-4">
          Knowledge Base
        </h3>
        
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-700" />
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-8 px-4">
            <p className="text-sm text-zinc-600">No documents yet.</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {documents.map((doc) => (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, x: 0 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 0 }}
                className="group flex items-center justify-between p-3 rounded-none border border-transparent hover:border-zinc-800 hover:bg-zinc-900 transition-all cursor-default"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-2 rounded-none ${
                    doc.status === 'ready' ? 'bg-zinc-800 text-zinc-400' :
                    doc.status === 'error' ? 'bg-red-900/20 text-red-400' :
                    'bg-zinc-800 text-white'
                  }`}>
                    {doc.status === 'ready' ? <File className="w-4 h-4" /> :
                     doc.status === 'error' ? <AlertCircle className="w-4 h-4" /> :
                     <Loader2 className="w-4 h-4 animate-spin" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate text-zinc-200">{doc.name}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-600 uppercase font-bold">{doc.file_type.split('/')[1] || 'DOC'}</span>
                      <span className="text-[10px] text-zinc-600">•</span>
                      <span className="text-[10px] text-zinc-600">
                        {doc.status === 'ready' ? 'Ready' : 
                         doc.status === 'error' ? 'Error' : 'Processing...'}
                      </span>
                    </div>
                  </div>
                </div>
                {isAdmin && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(doc.id, doc.name);
                    }}
                    disabled={isDeleting === doc.id}
                    className={`p-1.5 rounded-none transition-all flex items-center gap-1 text-zinc-700 hover:text-red-500 hover:bg-red-500/10 opacity-40 group-hover:opacity-100 ${isDeleting === doc.id ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    title="Delete document"
                  >
                    {isDeleting === doc.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Upload Modal */}
      <AnimatePresence>
        {isUploadOpen && (
          <DocumentUpload 
            onClose={() => setIsUploadOpen(false)} 
            companyId={companyId}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
