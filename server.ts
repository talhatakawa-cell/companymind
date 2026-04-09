import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Supabase Setup
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log('[Supabase] Initializing with URL:', supabaseUrl);
console.log('[Supabase] Service Key present:', !!supabaseServiceKey);

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('CRITICAL: Supabase environment variables are missing!');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

app.use(express.json({ limit: '50mb' }));

// Auth Middleware
const authMiddleware = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.warn(`[Auth] No auth header for ${req.path}`);
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.error(`[Auth] Invalid token for ${req.path}:`, error);
    return res.status(401).json({ error: 'Invalid token' });
  }

  // For the setup endpoint, we don't require a profile yet
  if (req.path === '/api/setup/workspace') {
    req.user = user;
    return next();
  }

  // Get user's company_id for other endpoints
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('company_id, role')
    .eq('id', user.id)
    .single();

  if (userError || !userData) {
    console.error(`[Auth] Profile not found for ${user.id} at ${req.path}:`, userError);
    return res.status(403).json({ 
      error: 'User profile not found. Please complete setup.',
      details: userError?.message 
    });
  }

  req.user = { ...user, ...userData };
  next();
};

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Workspace Setup (Bypasses RLS using Service Role Key)
app.post('/api/setup/workspace', authMiddleware, async (req: any, res: any) => {
  const { name } = req.body;
  const userId = req.user.id;
  const email = req.user.email;

  console.log(`[Setup] Setting up workspace for user: ${userId}, company: ${name}`);

  try {
    // 1. Create company
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .insert({ name })
      .select()
      .single();

    if (companyError) {
      console.error('[Setup] Company creation error:', companyError);
      throw companyError;
    }

    // 2. Create/Update user profile
    const { error: profileError } = await supabase
      .from('users')
      .upsert({ 
        id: userId, 
        company_id: company.id, 
        email, 
        role: 'admin' 
      });

    if (profileError) {
      console.error('[Setup] Profile upsert error:', profileError);
      throw profileError;
    }

    res.json({ success: true, company });
  } catch (error: any) {
    console.error('[Setup] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// User Invitation (Sends real email via Supabase Auth Admin)
app.post('/api/invite', authMiddleware, async (req: any, res: any) => {
  const { email, role } = req.body;
  const companyId = req.user.company_id;
  const inviterRole = req.user.role;

  console.log(`[Invite] Inviting: ${email} to company: ${companyId} (Role: ${role})`);

  if (inviterRole !== 'admin') {
    return res.status(403).json({ error: 'Only admins can invite users' });
  }

  if (!email || !role) {
    return res.status(400).json({ error: 'Email and role are required' });
  }

  try {
    // 1. Create invitation record in DB (for tracking)
    const { error: inviteDbError } = await supabase
      .from('invitations')
      .upsert({
        company_id: companyId,
        email: email.toLowerCase(),
        role: role
      }, { onConflict: 'company_id,email' });

    if (inviteDbError) {
      console.error('[Invite] DB error:', inviteDbError);
      throw inviteDbError;
    }

    // 2. Send invitation email via Supabase Auth Admin
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const { data, error: authError } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: appUrl,
      data: {
        invited_to_company: companyId,
        role: role
      }
    });

    if (authError) {
      console.error('[Invite] Auth error:', authError);
      
      // If user already exists, handle it gracefully
      if (
        authError.message.includes('already been registered') || 
        authError.message.includes('already exists') ||
        authError.message.includes('already been invited')
      ) {
        console.log('[Invite] User already exists in Auth, attempting to link to company directly...');
        
        // Try to find the user's ID to add them to the users table
        const { data: { users: foundUsers }, error: listError } = await supabase.auth.admin.listUsers();
        const existingUser = (foundUsers as any[])?.find(u => u.email?.toLowerCase() === email.toLowerCase());

        if (existingUser) {
          console.log('[Invite] Found existing user ID:', existingUser.id);
          const { error: profileError } = await supabase
            .from('users')
            .upsert({ 
              id: existingUser.id, 
              company_id: companyId, 
              email: email.toLowerCase(), 
              role: role 
            });

          if (profileError) {
            console.error('[Invite] Failed to update existing user profile:', profileError);
            throw profileError;
          }

          return res.json({ 
            success: true, 
            message: 'User already has an account and has been added to this workspace. They can sign in now.' 
          });
        }

        return res.json({ 
          success: true, 
          message: 'User is already registered or invited. Invitation record updated.' 
        });
      }
      throw authError;
    }

    res.json({ success: true, message: 'Invitation email sent successfully' });
  } catch (error: any) {
    console.error('[Invite] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Document Upload & Processing
app.post('/api/documents/upload', authMiddleware, async (req: any, res: any) => {
  const { name, content, fileType } = req.body;
  const companyId = req.user.company_id;

  console.log(`[Upload] Starting upload for: ${name} (${fileType}) for company: ${companyId}`);

  if (!companyId) {
    console.error('[Upload] Missing company ID');
    return res.status(400).json({ error: 'Missing company ID' });
  }

  try {
    // 1. Create document record
    console.log('[Upload] Creating document record in Supabase...');
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({
        company_id: companyId,
        name,
        file_type: fileType,
        status: 'processing'
      })
      .select()
      .single();

    if (docError) {
      console.error('[Upload] Supabase document insert error:', docError);
      throw docError;
    }
    console.log('[Upload] Document record created:', doc.id);

    // 2. Parse content
    console.log(`[Upload] Parsing content for: ${name}, type: ${fileType}`);
    let text = '';
    const buffer = Buffer.from(content, 'base64');
    console.log(`[Upload] Buffer created, size: ${buffer.length} bytes`);

    try {
      const lowerName = name.toLowerCase();
      
      if (fileType === 'application/pdf' || lowerName.endsWith('.pdf')) {
        console.log('[Upload] Parsing PDF...');
        console.log('[Upload] PDF parser type:', typeof pdf);
        console.log('[Upload] PDF parser keys:', Object.keys(pdf || {}));
        
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
          console.error('[Upload] PDF parser not found in loaded module. Keys:', Object.keys(pdf || {}));
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
            // Handle specific pdf-parse errors
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
      } else if (
        fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
        fileType === 'application/msword' || 
        lowerName.endsWith('.docx') || 
        lowerName.endsWith('.doc')
      ) {
        console.log('[Upload] Parsing Word doc...');
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } else if (
        fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
        fileType === 'application/vnd.ms-excel' || 
        fileType === 'text/csv' || 
        fileType === 'application/csv' ||
        lowerName.endsWith('.xlsx') || 
        lowerName.endsWith('.xls') || 
        lowerName.endsWith('.csv')
      ) {
        console.log('[Upload] Parsing Spreadsheet/CSV...');
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        text = xlsx.utils.sheet_to_csv(sheet);
      } else {
        console.log('[Upload] Parsing as plain text...');
        text = buffer.toString('utf-8');
      }
      console.log(`[Upload] Successfully parsed text, length: ${text.length} characters`);
    } catch (parseError) {
      console.error('[Upload] Parsing error:', parseError);
      throw new Error(`Failed to parse ${fileType}: ${parseError}`);
    }

    // 3. Chunk text (approx 300 words with 50 words overlap for better context)
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) {
      console.error('[Upload] No text could be extracted from the document');
      // Update status to error
      await supabase
        .from('documents')
        .update({ status: 'error' })
        .eq('id', doc.id);
      throw new Error('No text could be extracted from this document. It might be an image-only PDF or corrupted.');
    }

    const chunks = [];
    const chunkSize = 300;
    const overlap = 50;
    
    for (let i = 0; i < words.length; i += (chunkSize - overlap)) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      if (chunk.trim().length > 0) {
        chunks.push(chunk);
      }
      // If we've reached the end, stop
      if (i + chunkSize >= words.length) break;
    }
    console.log(`[Upload] Split into ${chunks.length} chunks`);

    // 4. Generate embeddings and store chunks
    console.log(`[Upload] Generating embeddings for ${chunks.length} chunks...`);
    const openrouterApiKey = process.env.DEEPSEEK_API_KEY;
    if (!openrouterApiKey) {
      throw new Error('DEEPSEEK_API_KEY is missing in server environment');
    }

    const chunksWithEmbeddings = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[Upload] Embedding chunk ${i + 1}/${chunks.length}`);
      const embeddingResponse = await axios.post(
        'https://openrouter.ai/api/v1/embeddings',
        {
          model: 'openai/text-embedding-3-large',
          input: chunks[i]
        },
        {
          headers: {
            'Authorization': `Bearer ${openrouterApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (embeddingResponse.status !== 200) {
        throw new Error(`Embedding generation failed: ${embeddingResponse.statusText}`);
      }

      const embedding = embeddingResponse.data.data[0].embedding;
      chunksWithEmbeddings.push({
        document_id: doc.id,
        company_id: companyId,
        content: chunks[i],
        embedding: embedding
      });
    }

    console.log(`[Upload] Storing ${chunksWithEmbeddings.length} chunks in Supabase...`);
    const { error: chunkError } = await supabase
      .from('document_chunks')
      .insert(chunksWithEmbeddings);

    if (chunkError) {
      console.error('[Upload] Supabase chunk insert error:', chunkError);
      throw chunkError;
    }

    // 5. Update status to ready
    await supabase
      .from('documents')
      .update({ status: 'ready' })
      .eq('id', doc.id);

    console.log('[Upload] Document processing complete');
    res.json({ success: true, documentId: doc.id });
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Store Document Chunks with Embeddings
app.post('/api/documents/chunks', authMiddleware, async (req: any, res: any) => {
  const { documentId, chunks } = req.body;
  const companyId = req.user.company_id;

  try {
    console.log(`[Chunks] Storing ${chunks.length} chunks for document: ${documentId} for company: ${companyId}`);
    
    if (!documentId || !chunks || !Array.isArray(chunks)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const chunksToInsert = chunks.map((chunk: any) => ({
      document_id: documentId,
      company_id: companyId,
      content: chunk.content,
      embedding: chunk.embedding
    }));

    const { error: chunkError } = await supabase
      .from('document_chunks')
      .insert(chunksToInsert);

    if (chunkError) {
      console.error('[Chunks] Supabase insert error:', chunkError);
      throw chunkError;
    }

    console.log(`[Chunks] Successfully stored ${chunks.length} chunks`);

    // Update status to ready
    const { error: updateError } = await supabase
      .from('documents')
      .update({ status: 'ready' })
      .eq('id', documentId);

    if (updateError) {
      console.error('[Chunks] Supabase status update error:', updateError);
      throw updateError;
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Chunk storage error:', error);
    res.status(500).json({ error: error.message || 'Failed to store chunks' });
  }
});

// AI Chat with RAG
app.post('/api/chat', authMiddleware, async (req: any, res: any) => {
  const { question } = req.body;
  const companyId = req.user.company_id;

  try {
    console.log(`[Chat] Processing question for company: ${companyId}`);
    const openrouterApiKey = process.env.DEEPSEEK_API_KEY;
    if (!openrouterApiKey) {
      console.error('[Chat] DEEPSEEK_API_KEY is missing');
      return res.status(500).json({ error: 'DeepSeek API key is not configured in server environment.' });
    }

    // 1. Generate embedding for the question
    console.log('[Chat] Generating embedding for question...');
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

    if (embeddingResponse.status !== 200) {
      throw new Error(`Embedding generation failed: ${embeddingResponse.statusText}`);
    }

    const embedding = embeddingResponse.data.data[0].embedding;

    // 2. Search for relevant chunks in Supabase using similarity search
    console.log('[Chat] Searching for relevant chunks...');
    const { data: chunks, error: searchError } = await supabase.rpc('match_document_chunks', {
      query_embedding: embedding,
      match_threshold: 0.2, // Lower threshold to be more permissive
      match_count: 8, // More chunks for better context
      p_company_id: companyId
    });

    if (searchError) {
      console.error('[Chat] Search error:', searchError);
      throw searchError;
    }

    if (chunks && chunks.length > 0) {
      console.log(`[Chat] Found ${chunks.length} relevant chunks. Top similarity: ${chunks[0].similarity}`);
    } else {
      console.log('[Chat] No relevant chunks found above threshold 0.3');
    }

    console.log(`[Chat] Found ${chunks?.length || 0} relevant chunks`);

    // 3. Prepare context for AI
    const context = chunks && chunks.length > 0 
      ? chunks.map((c: any) => `[Source: ${c.document_name}]\n${c.content}`).join('\n\n')
      : 'No relevant information found in the company documents.';
    
    const sources = chunks ? Array.from(new Set(chunks.map((c: any) => c.document_name))) as string[] : [];

    // 4. Call DeepSeek API via OpenRouter
    console.log('[Chat] Calling DeepSeek...');
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    
    const deepseekResponse = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
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
          {
            role: 'user',
            content: question
          }
        ],
        max_tokens: 1500,
        temperature: 0.2 // Small temperature for better variety but still focused
      },
      {
        headers: {
          'Authorization': `Bearer ${openrouterApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': appUrl,
          'X-Title': 'CompanyMind'
        }
      }
    );

    let answer = deepseekResponse.data.choices[0].message.content;
    console.log('[Chat] AI Raw Answer:', answer);
    let finalSources: string[] = [];

    // Extract sources from the answer if present
    const sourceMatch = answer.match(/SOURCES_USED:\s*(\[.*?\])/);
    if (sourceMatch) {
      try {
        const citedSources = JSON.parse(sourceMatch[1]);
        console.log('[Chat] Cited Sources from AI:', citedSources);
        
        if (Array.isArray(citedSources) && citedSources.length > 0) {
          // Filter to ensure we only include sources that actually exist in our retrieved chunks
          // and match what the AI cited
          finalSources = sources.filter(s => 
            citedSources.some((cited: string) => 
              s.toLowerCase().includes(cited.toLowerCase()) || 
              cited.toLowerCase().includes(s.toLowerCase())
            )
          );
        }
      } catch (e) {
        console.error('[Chat] Failed to parse sources JSON:', e);
        // Fallback: if JSON parse fails, try simple string matching
        const citedSourcesStr = sourceMatch[1].replace(/[\[\]"]/g, '');
        const citedSources = citedSourcesStr.split(',').map((s: string) => s.trim());
        finalSources = sources.filter(s => 
          citedSources.some(cited => 
            s.toLowerCase().includes(cited.toLowerCase()) || 
            cited.toLowerCase().includes(s.toLowerCase())
          )
        );
      }
      // Clean up the answer by removing the SOURCES_USED line
      answer = answer.replace(/SOURCES_USED:\s*\[.*?\]/, '').trim();
    } else {
      console.log('[Chat] No SOURCES_USED line found in AI response');
      // If no citation, we default to empty sources to be safe and avoid showing all retrieved chunks
      finalSources = [];
    }

    console.log('[Chat] Final Sources to display:', finalSources);

    const { data: chatRecord, error: insertError } = await supabase.from('chats').insert({
      user_id: req.user.id,
      company_id: companyId,
      question,
      answer,
      sources: finalSources
    }).select().single();

    if (insertError) {
      console.error('[Chat] Error saving chat history:', insertError);
    }

    res.json({ answer, sources: finalSources, chatRecord });
  } catch (error: any) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Global error handler:', err);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
