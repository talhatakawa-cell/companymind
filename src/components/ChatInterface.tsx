import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Send, Bot, User, Loader2, Info, MessageSquare, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function ChatInterface({ session, companyId }: { session: any, companyId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!companyId) return;

    const fetchHistory = async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('company_id', companyId)
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: true });

      if (data) setMessages(data);
      setHistoryLoading(false);
    };

    fetchHistory();

    // Real-time subscription for chats
    console.log('[Chat] Subscribing to real-time chats for company:', companyId);
    const channel = supabase
      .channel(`chats-${companyId}-${session.user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chats',
        filter: `company_id=eq.${companyId}`
      }, (payload) => {
        console.log('[Chat] Real-time message received:', payload.new);
        // Only add if it's for the current user (filter handles company, but let's be safe)
        if (payload.new.user_id === session.user.id) {
          setMessages(prev => {
            // Check if message already exists (to avoid duplicates from local state)
            const exists = prev.some(m => m.id === payload.new.id);
            if (exists) return prev;

            // Check if we have an optimistic message for this question
            const optimisticIdx = prev.findIndex(m => 
              (!m.id || String(m.id).startsWith('temp-')) && 
              m.question === payload.new.question
            );

            if (optimisticIdx !== -1) {
              // Replace optimistic message with the real one from DB
              const newMessages = [...prev];
              newMessages[optimisticIdx] = payload.new;
              return newMessages;
            }

            return [...prev, payload.new];
          });
        }
      })
      .subscribe((status) => {
        console.log(`[Chat] Subscription status: ${status}`);
      });

    return () => {
      console.log('[Chat] Unsubscribing from real-time chats');
      supabase.removeChannel(channel);
    };
  }, [companyId, session.user.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const tempId = `temp-${Date.now()}`;
    const userMessage = { 
      id: tempId,
      question: input, 
      answer: null, 
      sources: [], 
      created_at: new Date().toISOString() 
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ 
          question: input
        })
      });

      const contentType = response.headers.get('content-type');
      if (!response.ok) {
        let errorMessage = `Chat failed with status ${response.status}`;
        try {
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } else {
            const textError = await response.text();
            console.error('Server returned non-JSON error (chat):', textError);
            errorMessage = textError.slice(0, 200) || errorMessage;
          }
        } catch (e) {
          console.error('Error parsing chat error:', e);
        }
        throw new Error(errorMessage);
      }

      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Expected JSON but got (chat):', text);
        throw new Error('Server returned invalid response format');
      }

      const data = await response.json();
      setMessages(prev => {
        // Check if the real-time listener already added this message
        const alreadyExists = prev.some(m => m.id === data.chatRecord.id);
        
        if (alreadyExists) {
          // If it exists, just remove the optimistic temp message
          return prev.filter(m => m.id !== tempId);
        }

        // Update the optimistic message with the real data
        return prev.map(m => m.id === tempId ? { ...m, ...data.chatRecord, answer: data.answer, sources: data.sources } : m);
      });
    } catch (err: any) {
      setMessages(prev => {
        return prev.map(m => m.id === tempId ? { ...m, answer: `Error: ${err.message}`, sources: [] } : m);
      });
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    if (!confirm('Clear your chat history?')) return;
    await supabase.from('chats').delete().eq('user_id', session.user.id).eq('company_id', companyId);
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Chat Header */}
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-900">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-white" />
          <span className="font-bold text-white uppercase tracking-widest text-sm">AI Knowledge Assistant</span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            className="p-2 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded-none transition-all"
            title="Clear History"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Messages Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar bg-black"
      >
        {historyLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-zinc-700" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
            <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-none mb-6">
              <Bot className="w-12 h-12 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2 uppercase tracking-tight">How can I help you today?</h2>
            <p className="text-zinc-500 text-sm">Ask me anything about your company's documents, policies, or data.</p>
            <div className="grid grid-cols-1 gap-3 mt-8 w-full">
              {['What is our refund policy?', 'Show me Q3 sales numbers', 'What are the HR leave rules?'].map((q) => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="p-4 text-xs font-bold uppercase tracking-widest text-left text-zinc-400 border border-zinc-800 rounded-none hover:bg-zinc-900 hover:border-zinc-500 transition-all"
                >
                  "{q}"
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="space-y-6">
              {/* User Question */}
              <div className="flex items-start gap-4 justify-end">
                <div className="bg-zinc-800 border border-zinc-700 text-white p-4 rounded-none shadow-md max-w-[80%]">
                  <p className="text-sm leading-relaxed">{msg.question}</p>
                </div>
                <div className="bg-white p-2 rounded-none shrink-0">
                  <User className="w-5 h-5 text-black" />
                </div>
              </div>

              {/* AI Answer */}
              {msg.answer && (
                <motion.div 
                  initial={{ opacity: 0, y: 0 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-4"
                >
                  <div className="bg-zinc-800 p-2 rounded-none shrink-0">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <div className="space-y-3 max-w-[80%]">
                    <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-none shadow-sm">
                      <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{msg.answer}</p>
                    </div>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {msg.sources.map((source: string, sIdx: number) => (
                          <div key={sIdx} className="flex items-center gap-1.5 px-2.5 py-1 bg-black border border-zinc-800 rounded-none text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                            <Info className="w-3 h-3" />
                            {source}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>
          ))
        )}
        {loading && (
          <div className="flex items-start gap-4">
            <div className="bg-zinc-800 p-2 rounded-none shrink-0">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-none shadow-sm flex items-center gap-3">
              <div className="flex gap-1">
                <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 bg-zinc-500 rounded-full" />
                <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-zinc-500 rounded-full" />
                <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-zinc-500 rounded-full" />
              </div>
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest italic">Thinking...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-6 border-t border-zinc-800 shrink-0 bg-zinc-900">
        <form onSubmit={handleSend} className="relative max-w-4xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="TYPE YOUR QUESTION..."
            className="w-full pl-6 pr-14 py-4 bg-black border border-zinc-800 rounded-none focus:ring-1 focus:ring-white focus:border-transparent outline-none transition-all text-white placeholder:text-zinc-600 text-sm uppercase tracking-widest"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="absolute right-2 top-2 bottom-2 px-6 bg-white text-black rounded-none hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed transition-all shadow-md"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </form>
        <p className="text-center text-[10px] text-zinc-600 mt-3 font-bold uppercase tracking-[0.2em]">
          Secured by CompanyMind AI • Data isolated to your organization
        </p>
      </div>
    </div>
  );
}
