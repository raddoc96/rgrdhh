import { GoogleGenAI, GenerateContentResponse, Part, Content, SafetySetting, HarmCategory, HarmBlockThreshold, Type, GroundingChunk } from "@google/genai";
import { TeachingSectionContent, GroundingSource } from '../types';

const API_KEY = process.env.API_KEY;

export class MissingPdfError extends Error {
  constructor(message: string, public urls: string[]) {
    super(message);
    this.name = 'MissingPdfError';
  }
}

const safetySettings: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

export interface ChatResponse {
  text: string;
  sources: GroundingSource[];
  relatedLinks: GroundingSource[];
}

export async function getTeachingSections(
  context: { 
    urls?: string[]; 
    pdfs?: { base64: string; mimeType: string; }[]; 
    pastedTexts?: string[];
    searchQuery?: string; 
    focusTopic?: string; 
    model: string; 
  }
): Promise<{ sections: TeachingSectionContent[], sources: GroundingSource[] }> {
  if (!API_KEY) {
    throw new Error("API_KEY is not configured.");
  }
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const model = context.model;

  const contentPromptParts: Part[] = [];
  const tools: any[] = [];
  
  const sourceDescriptions: string[] = [];

  // URL context
  if (context.urls && context.urls.length > 0) {
    const urlList = context.urls.join(', ');
    sourceDescriptions.push(`the ${context.urls.length > 1 ? 'webpages' : 'webpage'} at the URL(s): ${urlList}`);
    if (!tools.some(tool => tool.hasOwnProperty('url_context'))) {
      tools.push({ "url_context": {} });
    }
  }

  // PDF context (file upload)
  if (context.pdfs && context.pdfs.length > 0) {
    sourceDescriptions.push(`the provided ${context.pdfs.length} PDF document(s)`);
    for (const pdf of context.pdfs) {
        contentPromptParts.push({
            inlineData: { data: pdf.base64, mimeType: pdf.mimeType }
        });
    }
  }

  // Pasted text context
  if (context.pastedTexts && context.pastedTexts.length > 0) {
    sourceDescriptions.push(`the provided ${context.pastedTexts.length} pasted text snippet(s)`);
    for (const text of context.pastedTexts) {
        contentPromptParts.push({ text: `--- START OF PASTED CONTENT ---\n${text}\n--- END OF PASTED CONTENT ---` });
    }
  }

  // Google Search context
  if (context.searchQuery) {
    sourceDescriptions.push(`a Google search for "${context.searchQuery}"`);
    if (!tools.some(tool => tool.hasOwnProperty('googleSearch'))) {
      tools.push({ googleSearch: {} });
    }
  }

  if (sourceDescriptions.length === 0) {
    throw new Error("No content provided to generate teaching sections.");
  }

  let baseText = `Your analysis should be based on the following merged sources: ${sourceDescriptions.join(' AND ')}. Please synthesize information from all these sources.`;
  if (context.searchQuery) {
    baseText += `\n\nWhen performing the Google Search, focus on this query: "${context.searchQuery}".`;
  }
  contentPromptParts.unshift({ text: baseText });


  let systemInstruction = `You are an expert radiology educator. Your task is to analyze the provided content and break it down into 5-7 sequential teaching sections.`;
  if (context.focusTopic && context.focusTopic.trim()) {
    systemInstruction += ` The user has a specific interest in "${context.focusTopic}". Focus your analysis and section creation on this topic, extracting all relevant details from the content.`;
  }
  
  systemInstruction += `
For each section, provide a title and a series of question-and-answer pairs that capture the core concepts.
The 'answer' for each question should be detailed, comprehensive, and can include Markdown for formatting.
Important: Your output is for experienced Radiologists, so maintain a professional, technical tone.`;

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        section_title: {
          type: Type.STRING,
          description: "A concise title for the teaching section."
        },
        qa_pairs: {
          type: Type.ARRAY,
          description: "A list of question and answer pairs for this section.",
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING, description: "The question." },
              answer: { type: Type.STRING, description: "The detailed answer to the question, potentially containing Markdown." }
            },
            required: ["question", "answer"]
          }
        }
      },
      required: ["section_title", "qa_pairs"],
    }
  };
  
  const config: any = {
    temperature: 0.6, 
    topP: 0.9,
    topK: 40,
    safetySettings: safetySettings,
  };

  const useGoogleSearch = tools.some(tool => tool.hasOwnProperty('googleSearch'));

  if (useGoogleSearch) {
    // Per documentation, when using googleSearch tool, don't set responseMimeType or responseSchema
    systemInstruction += "\nWhen creating the teaching sections, you MUST ground your entire response in the search results provided by the Google Search tool. The sources you use will be displayed to the user.";
    systemInstruction += `\nIf after searching you determine that the most relevant information is contained within PDF documents that you cannot access, you MUST NOT generate the teaching sections. Instead, your entire response MUST be a valid JSON object with a single key 'missing_pdfs', which is an array of strings, where each string is the URL of a PDF you need the user to upload. Example: {"missing_pdfs": ["https://example.com/study.pdf"]}. Only use this format if you are confident that the primary information is in an inaccessible PDF. Otherwise, the final output MUST be a valid JSON array of objects, strictly adhering to the provided schema. Do not add any text before or after the JSON. Do not wrap the JSON in markdown backticks.`;
  } else {
    config.responseMimeType = "application/json";
    config.responseSchema = schema;
    systemInstruction += `\nThe final output MUST be a valid JSON array of objects, strictly adhering to the provided schema. Do not add any text before or after the JSON.`;
  }

  if (tools.length > 0) {
      config.tools = tools;
  }
  
  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: model,
      contents: { role: 'user', parts: contentPromptParts },
      config: {
        systemInstruction,
        ...config
      },
    });

    let responseText = response.text;
    
    // Process sources from both Google Search and URL Context tool
    let sources: GroundingSource[] = [];

    // Process Google Search grounding chunks
    const groundingChunks: GroundingChunk[] | undefined = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (groundingChunks) {
        sources = groundingChunks
            .map(chunk => chunk.web)
            .filter((web): web is { uri: string; title: string } => !!web && !!web.uri && !!web.title);
    }
    
    // Process urlContext tool metadata, based on user-provided documentation
    const urlContextMetadata: any[] | undefined = (response.candidates?.[0] as any)?.urlContextMetadata;
    if (urlContextMetadata && Array.isArray(urlContextMetadata)) {
        const successfulUrlSources = urlContextMetadata
            .filter(meta => meta.urlRetrievalStatus === 'URL_RETRIEVAL_STATUS_SUCCESS' && meta.retrievedUrl)
            .map(meta => ({ uri: meta.retrievedUrl, title: meta.retrievedUrl }));

        successfulUrlSources.forEach(urlSource => {
            if (!sources.some(s => s.uri === urlSource.uri)) {
                sources.push(urlSource);
            }
        });

        const failedUrls = urlContextMetadata
            .filter(meta => meta.urlRetrievalStatus !== 'URL_RETRIEVAL_STATUS_SUCCESS')
            .map(meta => meta.retrievedUrl);
        
        if (failedUrls.length > 0) {
            console.warn(`[Gemini Service] Was unable to access the following URLs, so they were not included in the context: ${failedUrls.join(', ')}`);
        }
    }
    
    // If googleSearch was used, we must manually parse the JSON from the text response.
    if (useGoogleSearch) {
      const jsonMatch = responseText.match(/```(json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[2]) {
        responseText = jsonMatch[2];
      } else {
        const rawJsonMatch = responseText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (rawJsonMatch) {
            responseText = rawJsonMatch[0];
        } else {
            throw new Error("The AI returned a non-JSON response when Google Search was used. Could not find a valid JSON object or array.");
        }
      }
    }
    
    const parsedResponse = JSON.parse(responseText);

    if (parsedResponse.missing_pdfs && Array.isArray(parsedResponse.missing_pdfs) && parsedResponse.missing_pdfs.length > 0) {
      throw new MissingPdfError("The AI has requested you upload PDFs for more context.", parsedResponse.missing_pdfs);
    }

    if (Array.isArray(parsedResponse)) {
      return { sections: parsedResponse, sources };
    }
    throw new Error("The AI returned teaching sections in an unexpected format.");
  } catch (error) {
    if (error instanceof MissingPdfError) {
        throw error; // Re-throw our custom error to be caught by the UI
    }
    console.error("Error generating teaching sections:", error);
    if (error instanceof Error && error.message.includes("SAFETY")) {
        throw new Error("The content could not be processed due to safety filters. Please ensure the URL/query links to appropriate content.");
    }
    if (error instanceof SyntaxError) { // JSON.parse error
        throw new Error("Failed to parse the response from the AI as valid JSON. The AI's output may have been malformed.");
    }
    throw new Error("Failed to generate teaching sections. The AI model might be busy or there was an issue with the request.");
  }
}

export async function getFollowUpResponse(
  userMessage: string,
  context: { originalQuestion: string; originalAnswer: string, fullSectionContent: string },
  useGoogleSearch: boolean,
  history: Content[],
  modelName: string
): Promise<ChatResponse> {
  if (!API_KEY) {
    throw new Error("API_KEY is not configured.");
  }
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  let systemInstruction = `You are a helpful radiology AI teaching assistant. The user is asking a follow-up question about a specific topic from a lesson you are teaching.
  
  This is the immediate context for their question:
  - Original Question: "${context.originalQuestion}"
  - Original Answer: "${context.originalAnswer.substring(0, 500)}${context.originalAnswer.length > 500 ? '...' : ''}"
  
  This is the broader context of the entire teaching section:
  "${context.fullSectionContent.substring(0, 800)}${context.fullSectionContent.length > 800 ? '...' : ''}"
  
  Your task is to provide a clear, concise, and helpful answer to their follow-up question. Maintain a patient and encouraging tone.`;
  
  if (useGoogleSearch) {
    systemInstruction += "\nYou MUST use the Google Search tool to find the most up-to-date and relevant information to answer the user's question. Base your answer on the search results. When you use information from a search result, you MUST add a numeric citation in the format [1], [2], etc., directly after the statement. The citation numbers must correspond to the order of sources provided in the grounding metadata. For example: 'This is a statement from a source [1]. This is another statement from another source [2].'";
  } else {
    systemInstruction += "\nAnswer based ONLY on the provided context. If the answer to the user's question is not found within the provided context (Original Question, Original Answer, and broader context), you MUST respond with the exact phrase: \"The uploaded contents don't have an answer for that question. Please try the 'web for answer' option.\" Do not add any other text or explanation.";
  }

  const tools: any[] = [];
  if (useGoogleSearch) {
      tools.push({googleSearch: {}});
  }

  try {
    const response = await ai.models.generateContent({
        model: modelName,
        contents: history,
        config: {
            systemInstruction: systemInstruction,
            tools: tools.length > 0 ? tools : undefined,
            safetySettings: safetySettings,
            temperature: 0.7,
        },
    });

    const text = response.text;
    const groundingChunks: GroundingChunk[] | undefined = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    
    let sources: GroundingSource[] = [];
    if (groundingChunks) {
        sources = groundingChunks
            .map(chunk => chunk.web)
            .filter((web): web is { uri: string; title: string } => !!web && !!web.uri && !!web.title);
    }

    const urlRegex = /\bhttps?:\/\/\S+/gi;
    const extractedUrls = text.match(urlRegex) || [];
    const cleanedUrls = extractedUrls.map(url => {
      try {
        const urlObj = new URL(url.replace(/[.,;!?)\]>]+$/, ''));
        urlObj.hash = '';
        return urlObj.href;
      } catch (e) {
        return null;
      }
    }).filter((url): url is string => url !== null);

    const sourceUris = new Set(sources.map(s => s.uri));
    const relatedLinks: GroundingSource[] = [...new Set(cleanedUrls)]
        .filter(url => !sourceUris.has(url))
        .map(url => ({ uri: url, title: url }));


    return { text, sources, relatedLinks };

  } catch (error) {
    console.error("Error getting chat response from Gemini API:", error);
    if (error instanceof Error && error.message.includes("SAFETY")) {
        return { text: "I'm sorry, I cannot respond to that due to safety guidelines.", sources: [], relatedLinks: [] };
    }
    throw new Error("Failed to get chat response. The AI model might be unavailable.");
  }
}
