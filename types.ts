// Fix: Add Part to the import from "@google/genai"
import { Content, Part } from "@google/genai";

export interface GroundingSource {
  uri: string;
  title: string;
}

export interface ChatMessage extends Content {
  id: string;
  role: 'user' | 'model';
  parts: Part[];
  sources?: GroundingSource[];
  relatedLinks?: GroundingSource[];
}

export interface QuestionAnswerPair {
  question: string;
  answer: string;
}

export interface TeachingSectionContent {
  section_title: string;
  qa_pairs: QuestionAnswerPair[];
}
