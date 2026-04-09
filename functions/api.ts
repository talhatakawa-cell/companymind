import serverless from 'serverless-http';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';

const app = express();

// Supabase Setup
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

app.use(express.json({ limit: '50mb' }));

// Auth Middleware
const authMiddleware = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  if (req.path.includes('/setup/workspace')) {
    req.user = user;
    return next();
  }

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('company_id, role')
    .eq('id', user.id)
    .single();

  if (userError || !userData) return res.status(403).json({ error: 'User profile not found.' });

  req.user = { ...user, ...userData };
  next();
};

// API Routes (Prefix with /api for local, but Netlify redirects /api/* to this function)
const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));

router.post('/setup/workspace', authMiddleware, async (req: any, res: any) => {
  const { name } = req.body;
  const userId = req.user.id;
  try {
    const { data: company, error: companyError } = await supabase.from('companies').insert({ name }).select().single();
    if (companyError) throw companyError;
    await supabase.from('users').upsert({ id: userId, company_id: company.id, email: req.user.email, role: 'admin' });
    res.json({ success: true, company });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/documents/upload', authMiddleware, async (req: any, res: any) => {
  const { name, content, fileType } = req.body;
  const companyId = req.user.company_id;
  try {
    const { data: doc, error: docError } = await supabase.from('documents').insert({ company_id: companyId, name, file_type: fileType, status: 'processing' }).select().single();
    if (docError) throw docError;

    let text = '';
    const buffer = Buffer.from(content, 'base64');
    if (fileType === 'application/pdf') {
      let pdfParse: any = null;
      
      // Robust function detection for different module styles
      const findParser = (obj: any): any => {
        if (typeof obj === 'function') return obj;
        if (!obj || typeof obj !== 'object') return null;
        if (typeof obj.default === 'function') return obj.default;
        if (typeof obj.pdfParse === 'function') return obj.pdfParse;
        if (typeof obj.PDFParse === 'function') return obj.PDFParse;
        // Look for any function that might be the parser
        const funcKey = Object.keys(obj).find(key => typeof obj[key] === 'function');
        return funcKey ? obj[funcKey] : null;
      };

      pdfParse = findParser(pdf);

      if (!pdfParse) {
        throw new Error(`PDF parser library is not loaded correctly. Type: ${typeof pdf}. Keys: ${Object.keys(pdf || {}).join(', ')}`);
      }

      try {
        // Ensure buffer is valid
        if (!buffer || buffer.length === 0) {
          throw new Error('Invalid or empty file content');
        }
        
        console.log('[Upload] Attempting to call pdfParse function...');
        // Convert Buffer to Uint8Array as some versions/methods of pdf-parse expect it
        const uint8Array = new Uint8Array(buffer);
        
        const data = await pdfParse(uint8Array);
        if (!data) throw new Error('PDF parser returned no data');
        
        // Handle different return types (original pdf-parse vs new class-based)
        const rawResult = typeof data.getText === 'function' ? await data.getText() : data.text;
        if (typeof rawResult === 'string') {
          text = rawResult;
        } else if (rawResult && typeof rawResult === 'object' && typeof rawResult.text === 'string') {
          text = rawResult.text;
        } else {
          text = String(rawResult || '');
        }
      } catch (pdfError: any) {
        console.error('[Upload] PDF-specific parsing error:', pdfError);
        const errorMsg = String(pdfError);
        const errorName = pdfError.name || pdfError.constructor?.name;
        
        // Handle class constructor error
        if (errorMsg.includes("cannot be invoked without 'new'") || 
            errorMsg.includes("Class constructor") ||
            errorName === 'TypeError' && (pdfError.message.includes("cannot be invoked without 'new'") || pdfError.message.includes("Class constructor"))) {
          try {
            console.log('[Upload] Retrying PDF parse with "new" as it appears to be a class constructor...');
            const uint8Array = new Uint8Array(buffer);
            const instance = await new (pdfParse as any)(uint8Array);
            if (!instance) throw new Error('PDF parser (class) returned no instance');
            
            const rawResult = typeof instance.getText === 'function' ? await instance.getText() : instance.text;
            if (typeof rawResult === 'string') {
              text = rawResult;
            } else if (rawResult && typeof rawResult === 'object' && typeof rawResult.text === 'string') {
              text = rawResult.text;
            } else {
              text = String(rawResult || '');
            }
            console.log('[Upload] Successfully parsed PDF using class constructor');
          } catch (newError: any) {
            console.error('[Upload] PDF parse with "new" failed:', newError);
            throw new Error(`Failed to parse PDF as class: ${newError.message}`);
          }
        } else if (pdfError.message && pdfError.message.includes("reading 'length'")) {
          throw new Error(`PDF parsing failed: The file might be corrupted or in an unsupported format. (${pdfError.message})`);
        } else {
          const knownExceptions = ['AbortException', 'FormatError', 'InvalidPDFException', 'PasswordException', 'ResponseException', 'UnknownErrorException'];
          
          if (knownExceptions.includes(errorName) || knownExceptions.some(ex => errorMsg.includes(ex))) {
            if (errorName === 'PasswordException' || errorMsg.includes('PasswordException')) {
              throw new Error('The PDF file is password protected and cannot be parsed.');
            }
            throw new Error(`The PDF file appears to be invalid or corrupted (${errorName || 'PDF Error'}).`);
          }
          throw new Error(`Failed to parse PDF: ${pdfError.message || 'Unknown error'}`);
        }
      }
    } else if (fileType.includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (fileType.includes('spreadsheetml') || fileType === 'text/csv') {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      text = xlsx.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]);
    } else {
      text = buffer.toString('utf-8');
    }

    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) {
      console.error('[Upload] No text could be extracted from the document');
      await supabase.from('documents').update({ status: 'error' }).eq('id', doc.id);
      throw new Error('No text could be extracted from this document.');
    }
    const chunks = [];
    const chunkSize = 300;
    const overlap = 50;
    
    for (let i = 0; i < words.length; i += (chunkSize - overlap)) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      if (chunk.trim().length > 0) {
        chunks.push(chunk);
      }
      if (i + chunkSize >= words.length) break;
    }
    res.json({ success: true, documentId: doc.id, chunks });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/documents/chunks', authMiddleware, async (req: any, res: any) => {
  const { documentId, chunks } = req.body;
  try {
    const chunksToInsert = chunks.map((chunk: any) => ({ document_id: documentId, company_id: req.user.company_id, content: chunk.content, embedding: chunk.embedding }));
    const { error } = await supabase.from('document_chunks').insert(chunksToInsert);
    if (error) throw error;
    await supabase.from('documents').update({ status: 'ready' }).eq('id', documentId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/chat', authMiddleware, async (req: any, res: any) => {
  const { question } = req.body;
  try {
    const openrouterApiKey = process.env.DEEPSEEK_API_KEY;
    if (!openrouterApiKey) throw new Error('DEEPSEEK_API_KEY is missing');

    // 1. Generate embedding for the question
    const embeddingResponse = await axios.post(
      'https://openrouter.ai/api/v1/embeddings',
      {
        model: 'openai/text-embedding-3-large',
        input: question
      },
      {
        headers: {
          'Authorization': `Bearer ${openrouterApiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (embeddingResponse.status !== 200) throw new Error(`Embedding generation failed: ${embeddingResponse.statusText}`);
    const embedding = embeddingResponse.data.data[0].embedding;

    // 2. Search for relevant chunks
    const { data: chunks, error: searchError } = await supabase.rpc('match_document_chunks', { 
      query_embedding: embedding, 
      match_threshold: 0.2, 
      match_count: 8, 
      p_company_id: req.user.company_id 
    });
    
    if (searchError) throw searchError;

    if (chunks && chunks.length > 0) {
      console.log(`[Chat] Found ${chunks.length} relevant chunks. Top similarity: ${chunks[0].similarity}`);
    } else {
      console.log('[Chat] No relevant chunks found above threshold 0.3');
    }

    const context = chunks && chunks.length > 0 
      ? chunks.map((c: any) => `[Source: ${c.document_name}]\n${c.content}`).join('\n\n')
      : 'No relevant information found in the company documents.';
    
    const sources = chunks ? Array.from(new Set(chunks.map((c: any) => c.document_name))) as string[] : [];

    // 3. Call DeepSeek
    const deepseekResponse = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'deepseek/deepseek-chat',
      messages: [
        { 
          role: 'system', 
          content: `You are CompanyMind AI, a professional and highly capable corporate knowledge assistant. Your goal is to provide accurate, detailed, and helpful answers based on the provided company documents.

INSTRUCTIONS:
1. Use the provided context to answer the user's question thoroughly.
2. If the context contains the answer, provide it clearly with relevant details.
3. If the context is related but doesn't directly answer the question, summarize the relevant parts and explain what is missing.
4. If the context is completely irrelevant, politely state that you couldn't find specific information in the company documents, but offer to help with other topics.
5. Maintain a professional, helpful, and concise tone.
6. Use markdown for better readability (bullet points, bold text, etc.).

CRITICAL: At the end of your response, you MUST include a line starting with "SOURCES_USED:" followed by a JSON array of the document names you actually used to answer the question.
Only include a document if it provided specific information used in your response.

Example: 
Based on the Employee Handbook, our vacation policy is...
SOURCES_USED: ["Employee_Handbook.pdf"]

Context:
${context}`
        },
        { role: 'user', content: question }
      ],
      max_tokens: 1500,
      temperature: 0.2
    }, {
      headers: {
        'Authorization': `Bearer ${openrouterApiKey}`,
        'Content-Type': 'application/json'
      }
    });

    let answer = deepseekResponse.data.choices[0].message.content;
    const sourceMatch = answer.match(/SOURCES_USED:\s*(\[.*?\])/);
    let finalSources: string[] = [];
    
    if (sourceMatch) {
      try {
        const citedSources = JSON.parse(sourceMatch[1]);
        if (Array.isArray(citedSources) && citedSources.length > 0) {
          finalSources = sources.filter(s => 
            citedSources.some((cited: string) => 
              s.toLowerCase().includes(cited.toLowerCase()) || 
              cited.toLowerCase().includes(s.toLowerCase())
            )
          );
        }
      } catch (e) {
        console.error('[Chat] Failed to parse sources JSON:', e);
      }
      answer = answer.replace(/SOURCES_USED:\s*\[.*?\]/, '').trim();
    }

    const { data: chatRecord, error: insertError } = await supabase.from('chats').insert({ 
      user_id: req.user.id, 
      company_id: req.user.company_id, 
      question, 
      answer, 
      sources: finalSources 
    }).select().single();

    if (insertError) console.error('[Chat] Error saving chat history:', insertError);

    res.json({ answer, sources: finalSources, chatRecord });
  } catch (error: any) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use('/.netlify/functions/api', router);
app.use('/api', router);

export const handler = serverless(app);
