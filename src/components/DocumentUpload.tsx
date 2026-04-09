import React, { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { X, Upload, File, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';

export default function DocumentUpload({ onClose, companyId }: { onClose: () => void, companyId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
    }
  };

  const toBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result?.toString().split(',')[1] || '');
    reader.onerror = error => reject(error);
  });

  const handleUpload = async () => {
    console.log('Start Processing button clicked');
    if (!file) {
      console.error('No file selected');
      return;
    }
    if (!companyId) {
      console.error('No company ID found');
      return;
    }

    setUploading(true);
    setProgress(10);
    setError(null);

    try {
      console.log('Converting file to base64...');
      const base64 = await toBase64(file);
      console.log('Base64 conversion complete, length:', base64.length);
      setProgress(30);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.error('No session found');
        throw new Error('Not authenticated');
      }

      console.log('Sending upload request to server...');
    const response = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          name: file.name,
          content: base64,
          fileType: file.type || 'text/plain'
        })
      });

      console.log('Server response status:', response.status);
      const contentType = response.headers.get('content-type');
      
      if (!response.ok) {
        let errorMessage = `Upload failed with status ${response.status}`;
        try {
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } else {
            const textError = await response.text();
            console.error('Server returned non-JSON error:', textError);
            errorMessage = textError.slice(0, 200) || errorMessage;
          }
        } catch (e) {
          console.error('Error parsing server error:', e);
        }
        throw new Error(errorMessage);
      }

      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Expected JSON but got:', text);
        throw new Error('Server returned invalid response format');
      }

      const { documentId } = await response.json();
      console.log('Document created and processed on server');
      setProgress(100);
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error('Upload catch error:', err);
      setError(err.message);
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 1 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 1 }}
        className="bg-zinc-900 border border-zinc-800 rounded-none shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-xl font-bold text-white">Upload Knowledge</h3>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-none transition-colors">
            <X className="w-5 h-5 text-zinc-500" />
          </button>
        </div>

        <div className="p-8">
          {!file ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border border-zinc-800 bg-black rounded-none p-12 flex flex-col items-center justify-center gap-4 hover:border-zinc-500 transition-all cursor-pointer group"
            >
              <div className="bg-zinc-800 p-4 rounded-none group-hover:bg-white transition-all">
                <Upload className="w-8 h-8 text-white group-hover:text-black" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-white">Click to upload</p>
                <p className="text-sm text-zinc-500 mt-1 uppercase tracking-widest font-bold">PDF, WORD, EXCEL, CSV, TXT</p>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt"
              />
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-4 p-4 bg-black border border-zinc-800 rounded-none">
                <div className="bg-zinc-800 p-3 rounded-none">
                  <File className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{file.name}</p>
                  <p className="text-xs text-zinc-500">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
                {!uploading && !success && (
                  <button onClick={() => setFile(null)} className="p-2 hover:bg-zinc-800 rounded-none transition-colors">
                    <X className="w-4 h-4 text-zinc-500" />
                  </button>
                )}
              </div>

              {uploading && (
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                    <span>{progress < 100 ? 'Processing...' : 'Almost there...'}</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-1 bg-zinc-800 rounded-none overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      className="h-full bg-white"
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-900/20 text-red-400 text-sm rounded-none border border-red-900/50 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              {success && (
                <div className="p-3 bg-green-900/20 text-green-400 text-sm rounded-none border border-green-900/50 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  Document processed successfully!
                </div>
              )}

              {!uploading && !success && (
                <button
                  onClick={handleUpload}
                  className="w-full bg-white hover:bg-zinc-200 text-black py-4 rounded-none font-bold transition-all shadow-lg shadow-white/5"
                >
                  START PROCESSING
                </button>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
