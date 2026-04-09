export interface Company {
  id: string;
  name: string;
  created_at: string;
}

export interface User {
  id: string;
  company_id: string;
  email: string;
  role: 'admin' | 'member';
}

export interface Document {
  id: string;
  company_id: string;
  name: string;
  file_type: string;
  status: 'processing' | 'ready' | 'error';
  created_at: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  company_id: string;
  content: string;
  embedding: number[];
  created_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  company_id: string;
  question: string;
  answer: string;
  sources: string[];
  created_at: string;
}
